import os
import time
import csv
from io import StringIO
from datetime import datetime

from flask import Flask, jsonify, request, render_template, Response
from flask_sqlalchemy import SQLAlchemy
from flask_login import (
    LoginManager, login_user, login_required, logout_user, current_user, UserMixin
)
from passlib.hash import bcrypt
from sqlalchemy import text

app = Flask(__name__, template_folder="templates", static_folder="static")

# -------------------------------
# Config
# -------------------------------
app.config["SQLALCHEMY_DATABASE_URI"] = os.environ.get("DATABASE_URL")
app.config["SECRET_KEY"] = os.environ.get("SECRET_KEY", "change")
app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False
app.config["SESSION_COOKIE_SAMESITE"] = os.environ.get("SESSION_COOKIE_SAMESITE", "Lax")
app.config["SESSION_COOKIE_SECURE"] = os.environ.get("SESSION_COOKIE_SECURE", "false").lower() == "true"

db = SQLAlchemy(app)
login_manager = LoginManager(app)
login_manager.login_view = "index"

# -------------------------------
# Models
# -------------------------------
class User(db.Model, UserMixin):
    __tablename__ = "users"
    id = db.Column(db.Integer, primary_key=True)
    email = db.Column(db.String(255), unique=True, index=True, nullable=False)
    name = db.Column(db.String(120), nullable=False)
    pwd_hash = db.Column(db.String(255), nullable=False)
    role = db.Column(db.String(20), default="admin")

class Antenna(db.Model):
    __tablename__ = "antennas"
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(120), unique=True, index=True, nullable=False)
    address = db.Column(db.String(255), default="")

class GarmentType(db.Model):
    __tablename__ = "garment_types"
    id = db.Column(db.Integer, primary_key=True)
    label = db.Column(db.String(120), unique=True, nullable=False)
    has_size = db.Column(db.Boolean, default=True)

class StockItem(db.Model):
    __tablename__ = "stock_items"
    id = db.Column(db.Integer, primary_key=True)
    garment_type_id = db.Column(db.Integer, db.ForeignKey("garment_types.id"), nullable=False)
    antenna_id = db.Column(db.Integer, db.ForeignKey("antennas.id"), nullable=False)
    size = db.Column(db.String(20))
    quantity = db.Column(db.Integer, default=0)

    garment_type = db.relationship(GarmentType)
    antenna = db.relationship(Antenna)

class Volunteer(db.Model):
    __tablename__ = "volunteers"
    id = db.Column(db.Integer, primary_key=True)
    first_name = db.Column(db.String(120), index=True, nullable=False)
    last_name = db.Column(db.String(120), index=True, nullable=False)
    note = db.Column(db.Text, default="")

class Loan(db.Model):
    __tablename__ = "loans"
    id = db.Column(db.Integer, primary_key=True)
    volunteer_id = db.Column(db.Integer, db.ForeignKey("volunteers.id"), nullable=False)
    stock_item_id = db.Column(db.Integer, db.ForeignKey("stock_items.id"), nullable=False)
    qty = db.Column(db.Integer, default=1)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    returned_at = db.Column(db.DateTime, nullable=True)

    volunteer = db.relationship(Volunteer)
    stock_item = db.relationship(StockItem)

# ---- LOGS & INVENTORY ----
class Log(db.Model):
    __tablename__ = "logs"
    id = db.Column(db.Integer, primary_key=True)
    at = db.Column(db.DateTime, default=datetime.utcnow)
    actor = db.Column(db.String(255))  # email utilisateur ou "public"
    action = db.Column(db.String(80))
    entity = db.Column(db.String(40))
    entity_id = db.Column(db.Integer)
    details = db.Column(db.Text, default="")

class InventorySession(db.Model):
    __tablename__ = "inventory_sessions"
    id = db.Column(db.Integer, primary_key=True)
    antenna_id = db.Column(db.Integer, db.ForeignKey("antennas.id"), nullable=False)
    user_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=False)
    started_at = db.Column(db.DateTime, default=datetime.utcnow)
    closed_at = db.Column(db.DateTime, nullable=True)
    antenna = db.relationship(Antenna)
    user = db.relationship(User)

class InventoryLine(db.Model):
    __tablename__ = "inventory_lines"
    id = db.Column(db.Integer, primary_key=True)
    session_id = db.Column(db.Integer, db.ForeignKey("inventory_sessions.id"), nullable=False)
    stock_item_id = db.Column(db.Integer, db.ForeignKey("stock_items.id"), nullable=False)
    previous_qty = db.Column(db.Integer, default=0)
    counted_qty = db.Column(db.Integer, default=0)
    delta = db.Column(db.Integer, default=0)
    session = db.relationship(InventorySession)
    stock_item = db.relationship(StockItem)

@login_manager.user_loader
def load_user(uid):
    return db.session.get(User, int(uid))

def log_action(action: str, entity: str, entity_id: int | None = None, details: str = ""):
    actor = current_user.email if hasattr(current_user, "is_authenticated") and current_user.is_authenticated else "public"
    db.session.add(Log(actor=actor, action=action, entity=entity, entity_id=entity_id, details=details))

# -------------------------------
# Startup helpers
# -------------------------------
def wait_for_db(max_tries: int = 60, delay: float = 1.0):
    for _ in range(max_tries):
        try:
            db.session.execute(text("SELECT 1"))
            return
        except Exception:
            time.sleep(delay)
    raise RuntimeError("Base de données indisponible après attente")

with app.app_context():
    wait_for_db()
    db.create_all()
    # ensure default admin
    email = os.environ.get("ADMIN_EMAIL", "admin@pc.fr")
    if not User.query.filter_by(email=email).first():
        db.session.add(
            User(
                email=email,
                name=os.environ.get("ADMIN_NAME", "Admin"),
                pwd_hash=bcrypt.hash(os.environ.get("ADMIN_PASSWORD", "admin123")),
                role="admin",
            )
        )
        db.session.commit()

# -------------------------------
# Base & health
# -------------------------------
@app.route("/")
@app.route("/a/<int:antenna_id>")
def index(antenna_id=None):
    return render_template("index.html")

@app.get("/healthz")
def healthz():
    try:
        db.session.execute(text("SELECT 1"))
        return "ok", 200
    except Exception as e:
        return f"db error: {e}", 500

# -------------------------------
# Auth
# -------------------------------
@app.post("/api/login")
def login_api():
    d = request.get_json() or {}
    email = (d.get("email") or "").strip().lower()
    password = d.get("password") or ""
    u = User.query.filter_by(email=email).first()
    if not u or not bcrypt.verify(password, u.pwd_hash):
        return jsonify({"ok": False, "error": "Identifiants invalides"}), 401
    login_user(u)
    return jsonify({"ok": True, "user": {"id": u.id, "email": u.email, "name": u.name, "role": u.role}})

@app.post("/api/logout")
@login_required
def logout_api():
    logout_user()
    return jsonify({"ok": True})

@app.get("/api/me")
def me():
    if current_user.is_authenticated:
        return jsonify(
            {"ok": True, "user": {"id": current_user.id, "email": current_user.email, "name": current_user.name, "role": current_user.role}}
        )
    return jsonify({"ok": False})

# -------------------------------
# Stats / dashboard
# -------------------------------
@app.get("/api/stats")
@login_required
def stats():
    stock_total = db.session.query(db.func.coalesce(db.func.sum(StockItem.quantity), 0)).scalar()
    loans_open = Loan.query.filter(Loan.returned_at.is_(None)).count()
    volunteers = Volunteer.query.count()
    return jsonify({"stock_total": stock_total, "prets_ouverts": loans_open, "benevoles": volunteers})

# -------------------------------
# Antennas CRUD
# -------------------------------
@app.get("/api/antennas")
@login_required
def antennas_list():
    items = Antenna.query.order_by(Antenna.name).all()
    return jsonify([{"id": a.id, "name": a.name, "address": a.address} for a in items])

@app.post("/api/antennas")
@login_required
def antennas_add():
    d = request.get_json() or {}
    name = d.get("name", "").strip()
    if not name:
        return jsonify({"ok": False, "error": "Nom requis"}), 400
    if Antenna.query.filter_by(name=name).first():
        return jsonify({"ok": False, "error": "Cette antenne existe déjà"}), 409
    a = Antenna(name=name, address=d.get("address", "").strip())
    db.session.add(a)
    db.session.commit()
    return jsonify({"ok": True, "id": a.id, "name": a.name, "address": a.address})

@app.put("/api/antennas/<int:ant_id>")
@login_required
def antennas_update(ant_id):
    d = request.get_json() or {}
    a: Antenna = db.session.get(Antenna, ant_id)
    if not a:
        return jsonify({"ok": False}), 404
    new_name = d.get("name", a.name).strip()
    if new_name != a.name and Antenna.query.filter_by(name=new_name).first():
        return jsonify({"ok": False, "error": "Nom d'antenne déjà utilisé"}), 409
    a.name = new_name
    a.address = d.get("address", a.address).strip()
    db.session.commit()
    return jsonify({"ok": True})

@app.delete("/api/antennas/<int:ant_id>")
@login_required
def antennas_delete(ant_id):
    a: Antenna = db.session.get(Antenna, ant_id)
    if not a:
        return jsonify({"ok": False}), 404
    if StockItem.query.filter_by(antenna_id=ant_id).first():
        return jsonify({"ok": False, "error": "Impossible : cette antenne possède du stock."}), 400
    db.session.delete(a)
    db.session.commit()
    return jsonify({"ok": True})

# -------------------------------
# Users CRUD
# -------------------------------
@app.get("/api/users")
@login_required
def users_list():
    users = User.query.order_by(User.email).all()
    return jsonify([{"id": u.id, "email": u.email, "name": u.name, "role": u.role} for u in users])

@app.post("/api/users")
@login_required
def users_add():
    d = request.get_json() or {}
    email = (d.get("email", "").strip().lower())
    if not email or not d.get("password"):
        return jsonify({"ok": False, "error": "email et mot de passe requis"}), 400
    if User.query.filter_by(email=email).first():
        return jsonify({"ok": False, "error": "email déjà utilisé"}), 409
    u = User(
        email=email,
        name=d.get("name", "").strip() or email,
        pwd_hash=bcrypt.hash(d.get("password")),
        role=d.get("role", "admin"),
    )
    db.session.add(u)
    db.session.commit()
    return jsonify({"ok": True, "id": u.id})

@app.put("/api/users/<int:user_id>")
@login_required
def users_update(user_id):
    d = request.get_json() or {}
    u = db.session.get(User, user_id)
    if not u:
        return jsonify({"ok": False}), 404
    u.name = d.get("name", u.name)
    u.role = d.get("role", u.role)
    if d.get("password"):
        u.pwd_hash = bcrypt.hash(d["password"])
    db.session.commit()
    return jsonify({"ok": True})

@app.delete("/api/users/<int:user_id>")
@login_required
def users_delete(user_id):
    u = db.session.get(User, user_id)
    if not u:
        return jsonify({"ok": False}), 404
    if current_user.id == u.id:
        return jsonify({"ok": False, "error": "Impossible de supprimer votre propre compte."}), 400
    db.session.delete(u)
    db.session.commit()
    return jsonify({"ok": True})

# -------------------------------
# Garment Types
# -------------------------------
@app.get("/api/types")
@login_required
def types_list():
    items = GarmentType.query.order_by(GarmentType.label).all()
    return jsonify([{"id": t.id, "label": t.label, "has_size": t.has_size} for t in items])

@app.post("/api/types")
@login_required
def types_add():
    d = request.get_json() or {}
    label = d.get("label", "").strip()
    if not label:
        return jsonify({"ok": False, "error": "label requis"}), 400
    t = GarmentType(label=label, has_size=bool(d.get("has_size", True)))
    db.session.add(t)
    db.session.commit()
    return jsonify({"id": t.id})

# -------------------------------
# Stock CRUD + list
# -------------------------------
@app.get("/api/stock")
@login_required
def stock_list():
    out = []
    q = StockItem.query
    t = request.args.get("type_id", type=int)
    a = request.args.get("antenna_id", type=int)
    if t:
        q = q.filter(StockItem.garment_type_id == t)
    if a:
        q = q.filter(StockItem.antenna_id == a)
    for s in q.all():
        out.append(
            {
                "id": s.id,
                "garment_type_id": s.garment_type_id,
                "garment_type": s.garment_type.label,
                "antenna_id": s.antenna_id,
                "antenna": s.antenna.name,
                "size": s.size,
                "quantity": s.quantity,
            }
        )
    return jsonify(out)

@app.post("/api/stock")
@login_required
def stock_add():
    d=request.get_json() or {}
    t=int(d.get("garment_type_id")); a=int(d.get("antenna_id")); size=d.get("size"); qty=int(d.get("quantity") or 0)
    if qty<=0: return jsonify({"ok":False,"error":"quantité > 0 requise"}),400
    item = StockItem.query.filter_by(garment_type_id=t, antenna_id=a, size=size).first()
    if item: item.quantity += qty
    else: item = StockItem(garment_type_id=t, antenna_id=a, size=size, quantity=qty); db.session.add(item)
    log_action("stock.add","stock", getattr(item,"id",None), f"+{qty} type={t} ant={a} size={size}")
    db.session.commit(); return jsonify({"id":item.id})

@app.put("/api/stock/<int:item_id>")
@login_required
def stock_update(item_id):
    d=request.get_json() or {}
    s=db.session.get(StockItem, item_id)
    if not s: return jsonify({"ok":False}),404
    before=s.quantity
    s.garment_type_id=int(d.get("garment_type_id", s.garment_type_id))
    s.antenna_id=int(d.get("antenna_id", s.antenna_id))
    s.size=d.get("size", s.size)
    if "quantity" in d: s.quantity=int(d["quantity"])
    db.session.commit(); log_action("stock.update","stock", item_id, f"{before}->{s.quantity}")
    return jsonify({"ok":True})

@app.delete("/api/stock/<int:item_id>")
@login_required
def stock_delete(item_id):
    s=db.session.get(StockItem, item_id)
    if not s: return jsonify({"ok":False}),404
    db.session.delete(s)
    log_action("stock.delete","stock", item_id, "delete")
    db.session.commit()
    return jsonify({"ok":True})

# -------------------------------
# Volunteers CRUD
# -------------------------------
@app.get("/api/volunteers")
@login_required
def volunteers_list():
    items = Volunteer.query.order_by(Volunteer.last_name, Volunteer.first_name).all()
    return jsonify([{"id": v.id, "first_name": v.first_name, "last_name": v.last_name, "note": v.note} for v in items])

@app.post("/api/volunteers")
@login_required
def volunteers_add():
    d=request.get_json() or {}
    fn=d.get("first_name","").strip(); ln=d.get("last_name","").strip()
    if not fn or not ln: return jsonify({"ok":False,"error":"Prénom et nom requis"}),400
    v=Volunteer(first_name=fn, last_name=ln, note=d.get("note","").strip())
    db.session.add(v); db.session.commit(); return jsonify({"id":v.id})

@app.put("/api/volunteers/<int:vol_id>")
@login_required
def volunteers_update(vol_id):
    d=request.get_json() or {}
    v=db.session.get(Volunteer, vol_id)
    if not v: return jsonify({"ok":False}),404
    v.first_name=d.get("first_name",v.first_name).strip()
    v.last_name=d.get("last_name",v.last_name).strip()
    v.note=d.get("note",v.note).strip()
    db.session.commit(); return jsonify({"ok":True})

@app.delete("/api/volunteers/<int:vol_id>")
@login_required
def volunteers_delete(vol_id):
    v=db.session.get(Volunteer, vol_id)
    if not v: return jsonify({"ok":False}),404
    db.session.delete(v); db.session.commit(); return jsonify({"ok":True})

# -------------------------------
# Loans (admin + list)
# -------------------------------
@app.get("/api/volunteers/<int:vol_id>/loans")
@login_required
def volunteers_loans(vol_id):
    res = []
    for l in Loan.query.filter(Loan.volunteer_id == vol_id, Loan.returned_at.is_(None)).all():
        res.append(
            {
                "id": l.id,
                "qty": l.qty,
                "since": l.created_at.isoformat(),
                "type": l.stock_item.garment_type.label,
                "size": l.stock_item.size,
                "antenna": l.stock_item.antenna.name,
            }
        )
    return jsonify(res)

@app.get("/api/loans/open")
@login_required
def loans_open():
    res = []
    for l in Loan.query.filter(Loan.returned_at.is_(None)).all():
        res.append(
            {
                "id": l.id,
                "qty": l.qty,
                "since": l.created_at.isoformat(),
                "volunteer": f"{l.volunteer.last_name} {l.volunteer.first_name}",
                "type": l.stock_item.garment_type.label,
                "size": l.stock_item.size,
                "antenna": l.stock_item.antenna.name,
            }
        )
    return jsonify(res)

@app.post("/api/loans/return/<int:loan_id>")
@login_required
def loan_return(loan_id):
    l=db.session.get(Loan, loan_id)
    if not l or l.returned_at: return jsonify({"ok":False}),404
    l.returned_at=datetime.utcnow()
    item=db.session.get(StockItem, l.stock_item_id)
    item.quantity += l.qty
    db.session.commit()
    log_action("loan.return","loan", loan_id, f"+{l.qty} to stock_item={l.stock_item_id}")
    return jsonify({"ok":True})

# -------------------------------
# Public (QR antenne)
# -------------------------------
@app.get("/api/public/volunteer")
def public_find():
    fn=(request.args.get("first_name","")).strip()
    ln=(request.args.get("last_name","")).strip()
    v=Volunteer.query.filter(
        db.func.lower(Volunteer.first_name)==fn.lower(),
        db.func.lower(Volunteer.last_name)==ln.lower()
    ).first()
    if not v: return jsonify({"ok":False}),404
    return jsonify({"ok":True,"id":v.id,"first_name":v.first_name,"last_name":v.last_name})

@app.get("/api/public/stock")
def public_stock():
    antenna_id = request.args.get("antenna_id", type=int)
    q = StockItem.query.filter(StockItem.quantity>0)
    if antenna_id: q = q.filter(StockItem.antenna_id==antenna_id)
    res=[]
    for s in q.all():
        res.append({"id":s.id,"type":s.garment_type.label,"size":s.size,"antenna":s.antenna.name,"antenna_id":s.antenna_id,"quantity":s.quantity})
    return jsonify(res)

@app.get("/api/public/loans")
def public_loans():
    vol_id = request.args.get("volunteer_id", type=int)
    if not vol_id: return jsonify([])
    res=[]
    for l in Loan.query.filter(Loan.volunteer_id==vol_id, Loan.returned_at.is_(None)).all():
        res.append({"id":l.id,"qty":l.qty,"since":l.created_at.isoformat(),"type":l.stock_item.garment_type.label,"size":l.stock_item.size,"antenna":l.stock_item.antenna.name})
    return jsonify(res)

@app.post("/api/public/return/<int:loan_id>")
def public_return(loan_id):
    l=db.session.get(Loan, loan_id)
    if not l or l.returned_at: return jsonify({"ok":False}),404
    l.returned_at=datetime.utcnow()
    item=db.session.get(StockItem, l.stock_item_id)
    item.quantity += l.qty
    db.session.commit()
    log_action("loan.return.public","loan", loan_id, f"+{l.qty} to stock_item={l.stock_item_id}")
    return jsonify({"ok":True})

@app.post("/api/public/loan")
def public_loan():
    d=request.get_json() or {}
    v_id=int(d.get("volunteer_id")); s_id=int(d.get("stock_item_id")); qty=int(d.get("qty") or 1)
    item=db.session.get(StockItem, s_id)
    if not item or item.quantity<qty: return jsonify({"ok":False,"error":"Stock insuffisant"}),400
    item.quantity-=qty
    loan=Loan(volunteer_id=v_id, stock_item_id=s_id, qty=qty)
    db.session.add(loan); db.session.commit()
    log_action("loan.create","loan", loan.id, f"-{qty} from stock_item={s_id} by volunteer={v_id}")
    return jsonify({"ok":True})

# -------------------------------
# Inventory / Audit
# -------------------------------
@app.post("/api/inventory/start")
@login_required
def inventory_start():
    d=request.get_json() or {}
    ant=int(d.get("antenna_id") or 0)
    if not ant: return jsonify({"ok":False,"error":"antenna_id requis"}),400
    sess=InventorySession(antenna_id=ant, user_id=current_user.id)
    db.session.add(sess); db.session.commit()
    log_action("inventory.start","inventory",sess.id,f"antenna={ant}")
    return jsonify({"id":sess.id})

@app.get("/api/inventory/<int:sid>/items")
@login_required
def inventory_items(sid):
    sess=db.session.get(InventorySession, sid)
    if not sess or sess.closed_at: return jsonify({"ok":False}),404
    rows=[]
    for s in StockItem.query.filter_by(antenna_id=sess.antenna_id).all():
        rows.append({"stock_item_id":s.id,"type":s.garment_type.label,"size":s.size,"quantity":s.quantity})
    return jsonify({"antenna":sess.antenna.name,"rows":rows})

@app.post("/api/inventory/<int:sid>/count")
@login_required
def inventory_count(sid):
    d=request.get_json() or {}
    stock_id=int(d.get("stock_item_id")); counted=int(d.get("counted_qty") or 0)
    sess=db.session.get(InventorySession, sid)
    s=db.session.get(StockItem, stock_id)
    if not sess or not s or sess.closed_at: return jsonify({"ok":False}),404
    line=InventoryLine.query.filter_by(session_id=sid, stock_item_id=stock_id).first()
    if not line:
        line=InventoryLine(session_id=sid, stock_item_id=stock_id, previous_qty=s.quantity)
        db.session.add(line)
    line.counted_qty=counted; line.delta=counted - line.previous_qty
    db.session.commit()
    return jsonify({"ok":True})

@app.post("/api/inventory/<int:sid>/close")
@login_required
def inventory_close(sid):
    sess=db.session.get(InventorySession, sid)
    if not sess or sess.closed_at: return jsonify({"ok":False}),404
    lines=InventoryLine.query.filter_by(session_id=sid).all()
    for ln in lines:
        item=db.session.get(StockItem, ln.stock_item_id)
        if item:
            item.quantity = ln.counted_qty
    sess.closed_at=datetime.utcnow()
    log_action("inventory.close","inventory",sid,f"lines={len(lines)}")
    db.session.commit()
    return jsonify({"ok":True})

# -------------------------------
# Logs
# -------------------------------
@app.get("/api/logs")
@login_required
def logs_list():
    limit = min(int(request.args.get("limit", 100)), 1000)
    items = Log.query.order_by(Log.at.desc()).limit(limit).all()
    return jsonify([{
        "id":l.id,"at":l.at.isoformat(),"actor":l.actor,"action":l.action,
        "entity":l.entity,"entity_id":l.entity_id,"details":l.details
    } for l in items])

# -------------------------------
# Exports CSV (UTF-8-SIG + JOIN + historique)
# -------------------------------
def _csv_response(sio: StringIO, filename: str):
    data = sio.getvalue().encode("utf-8-sig")  # BOM pour Excel
    return Response(data, mimetype="text/csv",
                    headers={"Content-Disposition": f"attachment; filename={filename}"})

@app.get("/api/export/stock.csv")
@login_required
def export_stock_csv():
    rows = (
        db.session.query(
            StockItem.id,
            GarmentType.label,
            Antenna.name,
            StockItem.size,
            StockItem.quantity
        )
        .join(GarmentType, StockItem.garment_type_id == GarmentType.id)
        .join(Antenna, StockItem.antenna_id == Antenna.id)
        .filter(StockItem.quantity > 0)
        .order_by(GarmentType.label, Antenna.name, StockItem.size)
        .all()
    )
    si = StringIO(); w = csv.writer(si, delimiter=';')
    w.writerow(["id","type","antenne","taille","quantite"])
    for r in rows:
        w.writerow([r[0], r[1], r[2], r[3] or "", r[4]])
    return _csv_response(si, "stock.csv")

@app.get("/api/export/loans.csv")
@login_required
def export_loans_csv():
    rows = (
        db.session.query(
            Loan.id,
            Volunteer.last_name, Volunteer.first_name,
            GarmentType.label, StockItem.size,
            Antenna.name,
            Loan.qty, Loan.created_at
        )
        .join(Volunteer, Loan.volunteer_id == Volunteer.id)
        .join(StockItem, Loan.stock_item_id == StockItem.id)
        .join(GarmentType, StockItem.garment_type_id == GarmentType.id)
        .join(Antenna, StockItem.antenna_id == Antenna.id)
        .filter(Loan.returned_at.is_(None))
        .order_by(Loan.created_at.desc())
        .all()
    )
    si = StringIO(); w = csv.writer(si, delimiter=';')
    w.writerow(["id","benevole","type","taille","antenne","quantite","depuis"])
    for r in rows:
        w.writerow([r[0], f"{r[1]} {r[2]}", r[3], r[4] or "", r[5], r[6], r[7].isoformat()])
    return _csv_response(si, "loans_en_cours.csv")

@app.get("/api/export/loans_history.csv")
@login_required
def export_loans_history_csv():
    rows = (
        db.session.query(
            Loan.id,
            Volunteer.last_name, Volunteer.first_name,
            GarmentType.label, StockItem.size,
            Antenna.name,
            Loan.qty, Loan.created_at, Loan.returned_at
        )
        .join(Volunteer, Loan.volunteer_id == Volunteer.id)
        .join(StockItem, Loan.stock_item_id == StockItem.id)
        .join(GarmentType, StockItem.garment_type_id == GarmentType.id)
        .join(Antenna, StockItem.antenna_id == Antenna.id)
        .order_by(Loan.created_at.desc())
        .all()
    )
    si = StringIO(); w = csv.writer(si, delimiter=';')
    w.writerow(["id","benevole","type","taille","antenne","quantite","date_pret","date_retour"])
    for r in rows:
        w.writerow([
            r[0], f"{r[1]} {r[2]}", r[3], r[4] or "", r[5],
            r[6], r[7].isoformat(), (r[8].isoformat() if r[8] else "")
        ])
    return _csv_response(si, "loans_historique.csv")

# -------------------------------
# Debug helper
# -------------------------------
@app.post("/api/debug/ensure_admin")
def debug_ensure_admin():
    email = os.environ.get("ADMIN_EMAIL","admin@pc.fr")
    pwd = os.environ.get("ADMIN_PASSWORD","admin123")
    name = os.environ.get("ADMIN_NAME","Admin")
    u = User.query.filter_by(email=email).first()
    if not u:
        u = User(email=email, name=name, pwd_hash=bcrypt.hash(pwd), role="admin")
        db.session.add(u); db.session.commit()
        return jsonify({"ok": True, "created": True})
    return jsonify({"ok": True, "created": False})




# === Import / Template CSV bénévoles =========================================

from werkzeug.utils import secure_filename

@app.get("/api/volunteers/template.csv")
@login_required
def volunteers_template_csv():
    si = StringIO()
    w = csv.writer(si, delimiter=';')
    w.writerow(["Nom", "Prénom", "Note"])
    w.writerow(["DUPONT", "Jean", "Taille M"])
    w.writerow(["MARTIN", "Léa", ""])
    data = si.getvalue().encode("utf-8-sig")  # BOM pour Excel
    return Response(
        data, mimetype="text/csv",
        headers={"Content-Disposition": 'attachment; filename="benevoles_modele.csv"'}
    )

@app.post("/api/volunteers/import")
@login_required
def volunteers_import_csv():
    """Importe un CSV avec colonnes Nom;Prénom;Note (séparateur ; ou ,)"""
    if "file" not in request.files:
        return jsonify({"ok": False, "error": "Aucun fichier fourni"}), 400
    f = request.files["file"]
    filename = secure_filename(f.filename or "import.csv")
    raw = f.read()
    try:
        text_data = raw.decode("utf-8-sig")  # gère BOM
    except UnicodeDecodeError:
        text_data = raw.decode("latin-1")

    # Détection du séparateur
    try:
        dialect = csv.Sniffer().sniff(text_data.splitlines()[0])
        delim = dialect.delimiter
    except Exception:
        # défaut raisonnable si Sniffer échoue
        delim = ";" if text_data.count(";") >= text_data.count(",") else ","

    reader = csv.reader(StringIO(text_data), delimiter=delim)
    rows = list(reader)
    if not rows:
        return jsonify({"ok": False, "error": "Fichier vide"}), 400

    # Map colonnes
    header = [h.strip().lower() for h in rows[0]]
    def _col(*names):
        for n in names:
            if n in header: return header.index(n)
        return None

    idx_nom  = _col("nom", "lastname", "last name")
    idx_pren = _col("prénom", "prenom", "firstname", "first name")
    idx_note = _col("note", "infos", "info")
    if idx_nom is None or idx_pren is None:
        return jsonify({"ok": False, "error": "Colonnes requises: Nom, Prénom"}), 400

    # Cache des bénévoles existants (nom/prénom en minuscules)
    existing = set(
        (v.last_name.strip().lower(), v.first_name.strip().lower())
        for v in Volunteer.query.all()
    )

    added = 0
    skipped = 0
    for r in rows[1:]:
        if not r or all(not c.strip() for c in r):  # ligne vide
            continue
        try:
            ln = (r[idx_nom] or "").strip()
            fn = (r[idx_pren] or "").strip()
        except IndexError:
            continue
        if not ln or not fn:
            continue
        key = (ln.lower(), fn.lower())
        if key in existing:
            skipped += 1
            continue
        note = ""
        if idx_note is not None and idx_note < len(r):
            note = (r[idx_note] or "").strip()
        db.session.add(Volunteer(first_name=fn, last_name=ln, note=note))
        existing.add(key)
        added += 1

    db.session.commit()
    return jsonify({"ok": True, "filename": filename, "added": added, "skipped": skipped, "total": added + skipped})


# -------------------------------
# Main
# -------------------------------
if __name__ == "__main__":
    app.run(host="0.0.0.0", port=8000, debug=True)
