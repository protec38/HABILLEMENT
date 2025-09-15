import os
import time
import csv
from io import StringIO
from datetime import datetime, timedelta
from functools import wraps

from flask import (
    Flask, jsonify, request, render_template, Response, session, send_file
)
from flask_sqlalchemy import SQLAlchemy
from flask_login import (
    LoginManager, login_user, login_required, logout_user, current_user, UserMixin
)
from passlib.hash import bcrypt
from sqlalchemy import text, or_, func
from sqlalchemy.exc import IntegrityError

# -----------------------------------------------------------------------------
# Config
# -----------------------------------------------------------------------------
DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///dev.db")
SECRET_KEY = os.getenv("SECRET_KEY", "dev-secret")
DEFAULT_ADMIN_EMAIL = os.getenv("ADMIN_EMAIL", "admin@example.com")
DEFAULT_ADMIN_PASSWORD = os.getenv("ADMIN_PASSWORD", "admin")
PAGE_SIZE_DEFAULT = 25

app = Flask(
    __name__,
    static_folder=os.path.join(BASE_DIR, "static"),
    template_folder=os.path.join(BASE_DIR, "templates"),
)
app.config['SECRET_KEY'] = SECRET_KEY
app.config['SQLALCHEMY_DATABASE_URI'] = DATABASE_URL
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False

db = SQLAlchemy(app)

login_manager = LoginManager()
login_manager.login_view = "index"
login_manager.init_app(app)

# -----------------------------------------------------------------------------
# CSRF protection (session token)
# -----------------------------------------------------------------------------
def _ensure_csrf_token():
    if "_csrf_token" not in session:
        # token per session
        session["_csrf_token"] = os.urandom(24).hex()
    return session["_csrf_token"]

@app.before_request
def _set_csrf_cookie():
    # Expose token to frontend via response header (simple SPA; no templates)
    token = _ensure_csrf_token()
    # For CORS-less same-origin SPA, a header is enough; the front will echo it.
    # Nothing to return; headers are added in after_request

@app.after_request
def _attach_csrf_header(resp):
    token = session.get("_csrf_token")
    if token:
        resp.headers['X-CSRF-Token'] = token
    return resp

def require_csrf(f):
    @wraps(f)
    def wrapper(*args, **kwargs):
        if request.method in ("POST", "PUT", "PATCH", "DELETE"):
            sent = request.headers.get("X-CSRF-Token") or request.form.get("_csrf")
            if not sent or sent != session.get("_csrf_token"):
                return jsonify({"error": "CSRF token missing or invalid"}), 400
        return f(*args, **kwargs)
    return wrapper

# -----------------------------------------------------------------------------
# Models
# -----------------------------------------------------------------------------
class User(db.Model, UserMixin):
    id = db.Column(db.Integer, primary_key=True)
    email = db.Column(db.String(255), unique=True, nullable=False)
    password_hash = db.Column(db.String(255), nullable=False)
    role = db.Column(db.String(50), default="admin")  # "admin" or "manager"
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    def set_password(self, pw: str):
        self.password_hash = bcrypt.hash(pw)

    def check_password(self, pw: str) -> bool:
        return bcrypt.verify(pw, self.password_hash)

class Antenna(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(255), unique=True, nullable=False)
    address = db.Column(db.String(255))
    low_stock_threshold = db.Column(db.Integer, default=2)
    lat = db.Column(db.Float)
    lng = db.Column(db.Float)

class GarmentType(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    label = db.Column(db.String(255), unique=True, nullable=False)
    has_size = db.Column(db.Boolean, default=True)

class StockItem(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    garment_type_id = db.Column(db.Integer, db.ForeignKey('garment_type.id'), nullable=False)
    antenna_id = db.Column(db.Integer, db.ForeignKey('antenna.id'), nullable=False)
    size = db.Column(db.String(50))
    quantity = db.Column(db.Integer, default=0)
    tags_text = db.Column(db.Text, default="")  # CSV tags

    garment_type = db.relationship('GarmentType')
    antenna = db.relationship('Antenna')

class Volunteer(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    last_name = db.Column(db.String(255), nullable=False)
    first_name = db.Column(db.String(255), nullable=False)
    note = db.Column(db.String(255), default="")

class Loan(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    volunteer_id = db.Column(db.Integer, db.ForeignKey('volunteer.id'), nullable=False)
    stock_item_id = db.Column(db.Integer, db.ForeignKey('stock_item.id'), nullable=False)
    quantity = db.Column(db.Integer, default=1)
    loan_date = db.Column(db.DateTime, default=datetime.utcnow)
    return_date = db.Column(db.DateTime, nullable=True)

    volunteer = db.relationship('Volunteer')
    stock_item = db.relationship('StockItem')

class InventorySession(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    antenna_id = db.Column(db.Integer, db.ForeignKey('antenna.id'), nullable=False)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    started_at = db.Column(db.DateTime, default=datetime.utcnow)
    closed_at = db.Column(db.DateTime, nullable=True)

    antenna = db.relationship('Antenna')
    user = db.relationship('User')

class InventoryLine(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    session_id = db.Column(db.Integer, db.ForeignKey('inventory_session.id'), nullable=False)
    stock_item_id = db.Column(db.Integer, db.ForeignKey('stock_item.id'), nullable=False)
    counted_qty = db.Column(db.Integer, nullable=False)
    delta = db.Column(db.Integer, nullable=False)  # counted - existing

    session = db.relationship('InventorySession')
    stock_item = db.relationship('StockItem')

class Log(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    who_id = db.Column(db.Integer, db.ForeignKey('user.id'))
    what = db.Column(db.String(255))
    detail = db.Column(db.Text)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

# -----------------------------------------------------------------------------
# DB bootstrap
# -----------------------------------------------------------------------------
with app.app_context():
    db.create_all()

    # Ensure default admin
    if not User.query.first():
        u = User(email=DEFAULT_ADMIN_EMAIL)
        u.set_password(DEFAULT_ADMIN_PASSWORD)
        db.session.add(u)
        db.session.commit()

# -----------------------------------------------------------------------------
# Helpers
# -----------------------------------------------------------------------------
def tags_to_text(tags_list):
    return ",".join(sorted({t.strip() for t in tags_list if t.strip()}))

def text_to_tags(text):
    return [t.strip() for t in (text or "").split(",") if t.strip()]

def paginate(query, page:int, per_page:int):
    total = query.count()
    items = query.offset((page-1)*per_page).limit(per_page).all()
    return {
        "items": items,
        "total": total,
        "page": page,
        "per_page": per_page,
        "pages": (total + per_page - 1)//per_page
    }

def to_dict_stock(si: StockItem):
    return {
        "id": si.id,
        "garment_type_id": si.garment_type_id,
        "garment_type": si.garment_type.label if si.garment_type else None,
        "antenna_id": si.antenna_id,
        "antenna": si.antenna.name if si.antenna else None,
        "size": si.size,
        "quantity": si.quantity,
        "tags": text_to_tags(si.tags_text)
    }

def to_dict_loan(l: Loan):
    return {
        "id": l.id,
        "volunteer_id": l.volunteer_id,
        "volunteer": f"{l.volunteer.last_name} {l.volunteer.first_name}" if l.volunteer else None,
        "stock_item_id": l.stock_item_id,
        "stock_item": to_dict_stock(l.stock_item) if l.stock_item else None,
        "quantity": l.quantity,
        "loan_date": l.loan_date.isoformat(),
        "return_date": l.return_date.isoformat() if l.return_date else None
    }

# -----------------------------------------------------------------------------
# Auth
# -----------------------------------------------------------------------------
@login_manager.user_loader
def load_user(user_id):
    return User.query.get(int(user_id))

@app.get("/")
def index():
    # Rend la page d’entrée de la SPA (templates/index.html)
    return render_template("index.html")

@app.post("/api/login")
@require_csrf
def api_login():
    data = request.get_json() or {}
    email = data.get("email","").strip().lower()
    password = data.get("password","")
    user = User.query.filter_by(email=email).first()
    if not user or not user.check_password(password):
        return jsonify({"error":"Identifiants invalides"}), 401
    login_user(user)
    return jsonify({"ok": True, "user": {"id": user.id, "email": user.email, "role": user.role}})

@app.post("/api/logout")
@login_required
@require_csrf
def api_logout():
    logout_user()
    return jsonify({"ok": True})

@app.get("/api/me")
def api_me():
    if current_user.is_authenticated:
        return jsonify({"authenticated": True, "user": {"id": current_user.id, "email": current_user.email, "role": current_user.role}})
    return jsonify({"authenticated": False, "csrf": _ensure_csrf_token()})

# -----------------------------------------------------------------------------
# Antennas
# -----------------------------------------------------------------------------
@app.get("/api/antennas")
@login_required
def api_antennas_list():
    ants = Antenna.query.order_by(Antenna.name.asc()).all()
    return jsonify([{
        "id": a.id, "name": a.name, "address": a.address,
        "low_stock_threshold": a.low_stock_threshold, "lat": a.lat, "lng": a.lng
    } for a in ants])

@app.post("/api/antennas")
@login_required
@require_csrf
def api_antennas_create():
    d = request.get_json() or {}
    a = Antenna(
        name=d["name"].strip(),
        address=d.get("address"),
        low_stock_threshold=int(d.get("low_stock_threshold", 2)),
        lat=d.get("lat"),
        lng=d.get("lng"),
    )
    db.session.add(a)
    db.session.commit()
    return jsonify({"ok": True, "id": a.id})

@app.put("/api/antennas/<int:aid>")
@login_required
@require_csrf
def api_antennas_update(aid):
    a = Antenna.query.get_or_404(aid)
    d = request.get_json() or {}
    a.name = d.get("name", a.name)
    a.address = d.get("address", a.address)
    a.low_stock_threshold = int(d.get("low_stock_threshold", a.low_stock_threshold))
    a.lat = d.get("lat", a.lat)
    a.lng = d.get("lng", a.lng)
    db.session.commit()
    return jsonify({"ok": True})

@app.delete("/api/antennas/<int:aid>")
@login_required
@require_csrf
def api_antennas_delete(aid):
    # refuse deletion if stock exists
    if StockItem.query.filter_by(antenna_id=aid).count() > 0:
        return jsonify({"error":"Impossible de supprimer : antenne avec stock"}), 400
    Antenna.query.filter_by(id=aid).delete()
    db.session.commit()
    return jsonify({"ok": True})

# -----------------------------------------------------------------------------
# Garment types
# -----------------------------------------------------------------------------
@app.get("/api/types")
@login_required
def api_types_list():
    types_ = GarmentType.query.order_by(GarmentType.label.asc()).all()
    return jsonify([{"id": t.id, "label": t.label, "has_size": t.has_size} for t in types_])

@app.post("/api/types")
@login_required
@require_csrf
def api_types_create():
    d = request.get_json() or {}
    t = GarmentType(label=d["label"].strip(), has_size=bool(d.get("has_size", True)))
    db.session.add(t)
    db.session.commit()
    return jsonify({"ok": True, "id": t.id})

@app.delete("/api/types/<int:tid>")
@login_required
@require_csrf
def api_types_delete(tid):
    if StockItem.query.filter_by(garment_type_id=tid).count() > 0:
        return jsonify({"error":"Type utilisé par des stocks"}), 400
    GarmentType.query.filter_by(id=tid).delete()
    db.session.commit()
    return jsonify({"ok": True})

# -----------------------------------------------------------------------------
# Stock (list + CRUD + pagination + search)
# -----------------------------------------------------------------------------
@app.get("/api/stock")
@login_required
def api_stock_list():
    q = StockItem.query.join(GarmentType).join(Antenna)
    # filters
    type_id = request.args.get("type_id", type=int)
    antenna_id = request.args.get("antenna_id", type=int)
    search = (request.args.get("q") or "").strip().lower()

    if type_id:
        q = q.filter(StockItem.garment_type_id == type_id)
    if antenna_id:
        q = q.filter(StockItem.antenna_id == antenna_id)
    if search:
        like = f"%{search}%"
        q = q.filter(or_(
            func.lower(GarmentType.label).like(like),
            func.lower(StockItem.size).like(like),
            func.lower(StockItem.tags_text).like(like),
            func.lower(Antenna.name).like(like),
        ))

    q = q.order_by(GarmentType.label.asc(), Antenna.name.asc(), StockItem.size.asc().nullsfirst())

    # pagination
    page = int(request.args.get("page", 1))
    per_page = int(request.args.get("per_page", PAGE_SIZE_DEFAULT))
    result = paginate(q, page, per_page)
    return jsonify({
        **{k: result[k] for k in ("total","page","per_page","pages")},
        "items": [to_dict_stock(it) for it in result["items"]]
    })

@app.post("/api/stock")
@login_required
@require_csrf
def api_stock_create():
    d = request.get_json() or {}
    si = StockItem(
        garment_type_id=int(d["garment_type_id"]),
        antenna_id=int(d["antenna_id"]),
        size=d.get("size"),
        quantity=int(d.get("quantity", 0)),
        tags_text=tags_to_text(d.get("tags", [])),
    )
    db.session.add(si)
    db.session.commit()
    return jsonify({"ok": True, "id": si.id})

@app.put("/api/stock/<int:sid>")
@login_required
@require_csrf
def api_stock_update(sid):
    si = StockItem.query.get_or_404(sid)
    d = request.get_json() or {}
    si.size = d.get("size", si.size)
    if "quantity" in d:
        si.quantity = int(d["quantity"])
    if "garment_type_id" in d:
        si.garment_type_id = int(d["garment_type_id"])
    if "antenna_id" in d:
        si.antenna_id = int(d["antenna_id"])
    if "tags" in d:
        si.tags_text = tags_to_text(d.get("tags", []))
    db.session.commit()
    return jsonify({"ok": True})

@app.delete("/api/stock/<int:sid>")
@login_required
@require_csrf
def api_stock_delete(sid):
    # refuse deletion if loans exist
    if Loan.query.filter_by(stock_item_id=sid, return_date=None).count() > 0:
        return jsonify({"error": "Article prêté, suppression impossible"}), 400
    StockItem.query.filter_by(id=sid).delete()
    db.session.commit()
    return jsonify({"ok": True})

# -----------------------------------------------------------------------------
# Volunteers (search + pagination + CRUD)
# -----------------------------------------------------------------------------
@app.get("/api/volunteers")
@login_required
def api_volunteers_list():
    search = (request.args.get("q") or "").strip().lower()
    page = int(request.args.get("page", 1))
    per_page = int(request.args.get("per_page", PAGE_SIZE_DEFAULT))

    q = Volunteer.query
    if search:
        like = f"%{search}%"
        q = q.filter(or_(
            func.lower(Volunteer.last_name).like(like),
            func.lower(Volunteer.first_name).like(like),
            func.lower(Volunteer.note).like(like),
        ))
    q = q.order_by(Volunteer.last_name.asc(), Volunteer.first_name.asc())
    result = paginate(q, page, per_page)
    return jsonify({
        **{k: result[k] for k in ("total","page","per_page","pages")},
        "items": [{"id": v.id, "last_name": v.last_name, "first_name": v.first_name, "note": v.note} for v in result["items"]]
    })

@app.post("/api/volunteers")
@login_required
@require_csrf
def api_volunteer_create():
    d = request.get_json() or {}
    v = Volunteer(last_name=d["last_name"].strip(), first_name=d["first_name"].strip(), note=d.get("note",""))
    db.session.add(v)
    db.session.commit()
    return jsonify({"ok": True, "id": v.id})

@app.put("/api/volunteers/<int:vid>")
@login_required
@require_csrf
def api_volunteer_update(vid):
    v = Volunteer.query.get_or_404(vid)
    d = request.get_json() or {}
    v.last_name = d.get("last_name", v.last_name)
    v.first_name = d.get("first_name", v.first_name)
    v.note = d.get("note", v.note)
    db.session.commit()
    return jsonify({"ok": True})

@app.delete("/api/volunteers/<int:vid>")
@login_required
@require_csrf
def api_volunteer_delete(vid):
    # refuse deletion if loans
    if Loan.query.filter_by(volunteer_id=vid, return_date=None).count() > 0:
        return jsonify({"error":"Bénévole avec prêt en cours"}), 400
    Volunteer.query.filter_by(id=vid).delete()
    db.session.commit()
    return jsonify({"ok": True})

# -----------------------------------------------------------------------------
# Loans
# -----------------------------------------------------------------------------
@app.get("/api/loans")
@login_required
def api_loans_list():
    only_open = request.args.get("open", "1") == "1"
    q = Loan.query.order_by(Loan.loan_date.desc())
    if only_open:
        q = q.filter(Loan.return_date.is_(None))
    loans = q.all()
    return jsonify([to_dict_loan(l) for l in loans])

@app.post("/api/loans")
@login_required
@require_csrf
def api_loans_create():
    d = request.get_json() or {}
    stock_id = int(d["stock_item_id"])
    qty = int(d.get("quantity", 1))
    vol_id = int(d["volunteer_id"])

    si = StockItem.query.get_or_404(stock_id)
    if si.quantity < qty:
        return jsonify({"error":"Stock insuffisant"}), 400

    si.quantity -= qty
    loan = Loan(volunteer_id=vol_id, stock_item_id=stock_id, quantity=qty)
    db.session.add(loan)
    db.session.commit()
    return jsonify({"ok": True, "id": loan.id})

@app.post("/api/loans/<int:lid>/return")
@login_required
@require_csrf
def api_loans_return(lid):
    loan = Loan.query.get_or_404(lid)
    if loan.return_date:
        return jsonify({"ok": True})  # idempotent
    loan.return_date = datetime.utcnow()
    loan.stock_item.quantity += loan.quantity
    db.session.commit()
    return jsonify({"ok": True})

# -----------------------------------------------------------------------------
# Inventory sessions (create, lines, close, history)
# -----------------------------------------------------------------------------
@app.post("/api/inventory/start")
@login_required
@require_csrf
def api_inventory_start():
    d = request.get_json() or {}
    sess = InventorySession(
        antenna_id=int(d["antenna_id"]),
        user_id=current_user.id
    )
    db.session.add(sess)
    db.session.commit()
    return jsonify({"ok": True, "session_id": sess.id})

@app.get("/api/inventory/<int:sid>/items")
@login_required
def api_inventory_items(sid):
    # list stock for antenna of the session
    sess = InventorySession.query.get_or_404(sid)
    items = StockItem.query.filter_by(antenna_id=sess.antenna_id).order_by(StockItem.id.asc()).all()
    return jsonify([to_dict_stock(i) for i in items])

@app.post("/api/inventory/<int:sid>/count")
@login_required
@require_csrf
def api_inventory_count(sid):
    sess = InventorySession.query.get_or_404(sid)
    d = request.get_json() or {}
    stock_id = int(d["stock_item_id"])
    counted = int(d["counted"])
    si = StockItem.query.get_or_404(stock_id)

    delta = counted - si.quantity
    line = InventoryLine(session_id=sess.id, stock_item_id=si.id, counted_qty=counted, delta=delta)
    si.quantity = counted
    db.session.add(line)
    db.session.commit()
    return jsonify({"ok": True, "line_id": line.id, "delta": delta})

@app.post("/api/inventory/<int:sid>/close")
@login_required
@require_csrf
def api_inventory_close(sid):
    sess = InventorySession.query.get_or_404(sid)
    if not sess.closed_at:
        sess.closed_at = datetime.utcnow()
        db.session.commit()
    return jsonify({"ok": True})

@app.get("/api/inventories/history")
@login_required
def api_inventories_history():
    # sessions with aggregates
    q = db.session.query(
        InventorySession.id,
        InventorySession.started_at,
        InventorySession.closed_at,
        Antenna.name.label("antenna"),
        User.email.label("user"),
        func.sum(func.abs(InventoryLine.delta)).label("total_delta")
    ).join(Antenna, InventorySession.antenna_id == Antenna.id
    ).join(User, InventorySession.user_id == User.id
    ).outerjoin(InventoryLine, InventoryLine.session_id == InventorySession.id
    ).group_by(InventorySession.id, Antenna.name, User.email
    ).order_by(InventorySession.started_at.desc())
    rows = q.all()
    return jsonify([{
        "id": r.id,
        "started_at": r.started_at.isoformat(),
        "closed_at": r.closed_at.isoformat() if r.closed_at else None,
        "antenna": r.antenna,
        "user": r.user,
        "total_delta": int(r.total_delta or 0)
    } for r in rows])

@app.get("/api/inventories/<int:sid>/lines")
@login_required
def api_inventory_lines(sid):
    lines = InventoryLine.query.filter_by(session_id=sid).order_by(InventoryLine.id.asc()).all()
    return jsonify([{
        "id": l.id,
        "stock_item": to_dict_stock(l.stock_item),
        "counted_qty": l.counted_qty,
        "delta": l.delta
    } for l in lines])

# -----------------------------------------------------------------------------
# Exports (CSV)
# -----------------------------------------------------------------------------
def _csv_response(filename: str, rows: list, header: list):
    si = StringIO()
    writer = csv.writer(si)
    if header:
        writer.writerow(header)
    for r in rows:
        writer.writerow(r)
    output = si.getvalue().encode("utf-8")
    return Response(
        output,
        mimetype="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'}
    )

@app.get("/api/export/stock")
@login_required
def api_export_stock():
    q = db.session.query(
        StockItem.id, GarmentType.label, Antenna.name, StockItem.size,
        StockItem.quantity, StockItem.tags_text
    ).join(GarmentType, StockItem.garment_type_id == GarmentType.id
    ).join(Antenna, StockItem.antenna_id == Antenna.id
    ).order_by(GarmentType.label.asc(), Antenna.name.asc())
    rows = q.all()
    return _csv_response("stock.csv", rows, ["id","type","antenne","taille","quantité","tags"])

@app.get("/api/export/loans")
@login_required
def api_export_loans():
    q = db.session.query(
        Loan.id, Volunteer.last_name, Volunteer.first_name,
        GarmentType.label, Antenna.name, StockItem.size,
        Loan.quantity, Loan.loan_date, Loan.return_date
    ).join(Volunteer, Loan.volunteer_id == Volunteer.id
    ).join(StockItem, Loan.stock_item_id == StockItem.id
    ).join(GarmentType, StockItem.garment_type_id == GarmentType.id
    ).join(Antenna, StockItem.antenna_id == Antenna.id
    ).order_by(Loan.loan_date.desc())
    rows = [(i, ln, fn, gt, ant, size, qty, ld.isoformat(), rd.isoformat() if rd else "")
            for (i, ln, fn, gt, ant, size, qty, ld, rd) in q.all()]
    return _csv_response("loans.csv", rows, ["id","nom","prénom","type","antenne","taille","quantité","date_pret","date_retour"])

# -----------------------------------------------------------------------------
# Stats & graphs
# -----------------------------------------------------------------------------
@app.get("/api/stats")
@login_required
def api_stats():
    total_stock = db.session.query(func.sum(StockItem.quantity)).scalar() or 0
    open_loans = Loan.query.filter(Loan.return_date.is_(None)).count()
    volunteers = Volunteer.query.count()
    return jsonify({"total_stock": int(total_stock), "open_loans": open_loans, "volunteers": volunteers})

@app.get("/api/stats/graph")
@login_required
def api_stats_graph():
    # Stock per antenna
    per_ant = db.session.query(
        Antenna.name, func.sum(StockItem.quantity)
    ).join(StockItem, StockItem.antenna_id == Antenna.id
    ).group_by(Antenna.name).order_by(Antenna.name.asc()).all()
    stock_by_antenna = [{"label": n, "value": int(s or 0)} for (n, s) in per_ant]

        # Loans by week for the last 12 weeks
    since = datetime.utcnow() - timedelta(weeks=12)
    if 'sqlite' in DATABASE_URL:
        week_expr = func.strftime('%Y-%W', Loan.loan_date)
    else:
        week_expr = func.to_char(Loan.loan_date, 'IYYY-IW')

    loans = (
        db.session.query(week_expr.label("week"), func.count(Loan.id))
        .filter(Loan.loan_date >= since)
        .group_by("week")
        .order_by(week_expr.asc())
        .all()
    )
    loan_series = [{"label": k, "value": int(v)} for (k, v) in loans]


    return jsonify({"stock_by_antenna": stock_by_antenna, "loans_per_week": loan_series})

# -----------------------------------------------------------------------------
# Run (for local)
# -----------------------------------------------------------------------------
if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.getenv("PORT", 5000)))
