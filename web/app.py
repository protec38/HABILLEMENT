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

# Config
app.config["SQLALCHEMY_DATABASE_URI"] = os.environ.get("DATABASE_URL")
app.config["SECRET_KEY"] = os.environ.get("SECRET_KEY", "change")
app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False
app.config["SESSION_COOKIE_SAMESITE"] = os.environ.get("SESSION_COOKIE_SAMESITE", "Lax")
app.config["SESSION_COOKIE_SECURE"] = os.environ.get("SESSION_COOKIE_SECURE", "false").lower() == "true"

db = SQLAlchemy(app)
login_manager = LoginManager(app)
login_manager.login_view = "index"


# =========================
# MODELS
# =========================
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


@login_manager.user_loader
def load_user(uid):
    return db.session.get(User, int(uid))


# =========================
# STARTUP HELPERS
# =========================
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


# =========================
# ROUTES - BASE & HEALTH
# =========================
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


# =========================
# AUTH
# =========================
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


# =========================
# STATS / DASHBOARD
# =========================
@app.get("/api/stats")
@login_required
def stats():
    stock_total = db.session.query(db.func.coalesce(db.func.sum(StockItem.quantity), 0)).scalar()
    loans_open = Loan.query.filter(Loan.returned_at.is_(None)).count()
    volunteers = Volunteer.query.count()
    return jsonify({"stock_total": stock_total, "prets_ouverts": loans_open, "benevoles": volunteers})



# =========================
# ANTENNAS
# =========================
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
    a = Antenna(name=name, address=d.get("address", "").strip())
    db.session.add(a)
    db.session.commit()
    return jsonify({"id": a.id, "name": a.name, "address": a.address})


# =========================
# USERS (ADMINS)
# =========================
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


# =========================
# GARMENT TYPES
# =========================
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


# =========================
# STOCK
# =========================
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
    d = request.get_json() or {}
    try:
        t = int(d.get("garment_type_id"))
        a = int(d.get("antenna_id"))
    except Exception:
        return jsonify({"ok": False, "error": "garment_type_id et antenna_id requis"}), 400
    size = d.get("size")
    qty = int(d.get("quantity") or 0)
    if qty <= 0:
        return jsonify({"ok": False, "error": "quantité > 0 requise"}), 400
    item = StockItem.query.filter_by(garment_type_id=t, antenna_id=a, size=size).first()
    if item:
        item.quantity += qty
    else:
        item = StockItem(garment_type_id=t, antenna_id=a, size=size, quantity=qty)
        db.session.add(item)
    db.session.commit()
    return jsonify({"id": item.id})


@app.put("/api/stock/<int:item_id>")
@login_required
def stock_update(item_id):
    d = request.get_json() or {}
    s = db.session.get(StockItem, item_id)
    if not s:
        return jsonify({"ok": False}), 404
    if "garment_type_id" in d:
        s.garment_type_id = int(d["garment_type_id"])
    if "antenna_id" in d:
        s.antenna_id = int(d["antenna_id"])
    if "size" in d:
        s.size = d["size"]
    if "quantity" in d:
        s.quantity = int(d["quantity"])
    db.session.commit()
    return jsonify({"ok": True})


@app.delete("/api/stock/<int:item_id>")
@login_required
def stock_delete(item_id):
    s = db.session.get(StockItem, item_id)
    if not s:
        return jsonify({"ok": False}), 404
    db.session.delete(s)
    db.session.commit()
    return jsonify({"ok": True})


# =========================
# VOLUNTEERS
# =========================
@app.get("/api/volunteers")
@login_required
def volunteers_list():
    items = Volunteer.query.order_by(Volunteer.last_name, Volunteer.first_name).all()
    return jsonify([{"id": v.id, "first_name": v.first_name, "last_name": v.last_name, "note": v.note} for v in items])


@app.post("/api/volunteers")
@login_required
def volunteers_add():
    d = request.get_json() or {}
    fn = d.get("first_name", "").strip()
    ln = d.get("last_name", "").strip()
    if not fn or not ln:
        return jsonify({"ok": False, "error": "Prénom et nom requis"}), 400
    v = Volunteer(first_name=fn, last_name=ln, note=d.get("note", "").strip())
    db.session.add(v)
    db.session.commit()
    return jsonify({"id": v.id})


@app.put("/api/volunteers/<int:vol_id>")
@login_required
def volunteers_update(vol_id):
    d = request.get_json() or {}
    v = db.session.get(Volunteer, vol_id)
    if not v:
        return jsonify({"ok": False}), 404
    v.first_name = d.get("first_name", v.first_name).strip()
    v.last_name = d.get("last_name", v.last_name).strip()
    v.note = d.get("note", v.note).strip()
    db.session.commit()
    return jsonify({"ok": True})


@app.delete("/api/volunteers/<int:vol_id>")
@login_required
def volunteers_delete(vol_id):
    v = db.session.get(Volunteer, vol_id)
    if not v:
        return jsonify({"ok": False}), 404
    db.session.delete(v)
    db.session.commit()
    return jsonify({"ok": True})


# =========================
# LOANS
# =========================
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
    l = db.session.get(Loan, loan_id)
    if not l or l.returned_at:
        return jsonify({"ok": False}), 404
    l.returned_at = datetime.utcnow()
    item = db.session.get(StockItem, l.stock_item_id)
    item.quantity += l.qty
    db.session.commit()
    return jsonify({"ok": True})





# =========================
# PUBLIC API (QR ANTENNE)
# =========================
@app.get("/api/public/volunteer")
def public_find():
    fn = (request.args.get("first_name", "")).strip()
    ln = (request.args.get("last_name", "")).strip()
    v = Volunteer.query.filter(
        db.func.lower(Volunteer.first_name) == fn.lower(),
        db.func.lower(Volunteer.last_name) == ln.lower(),
    ).first()
    if not v:
        return jsonify({"ok": False}), 404
    return jsonify({"ok": True, "id": v.id, "first_name": v.first_name, "last_name": v.last_name})


@app.get("/api/public/stock")
def public_stock():
    antenna_id = request.args.get("antenna_id", type=int)
    q = StockItem.query.filter(StockItem.quantity > 0)
    if antenna_id:
        q = q.filter(StockItem.antenna_id == antenna_id)
    res = []
    for s in q.all():
        res.append(
            {
                "id": s.id,
                "type": s.garment_type.label,
                "size": s.size,
                "antenna": s.antenna.name,
                "antenna_id": s.antenna_id,
                "quantity": s.quantity,
            }
        )
    return jsonify(res)


@app.get("/api/public/loans")
def public_loans():
    vol_id = request.args.get("volunteer_id", type=int)
    if not vol_id:
        return jsonify([])
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


@app.post("/api/public/return/<int:loan_id>")
def public_return(loan_id):
    l = db.session.get(Loan, loan_id)
    if not l or l.returned_at:
        return jsonify({"ok": False}), 404
    l.returned_at = datetime.utcnow()
    item = db.session.get(StockItem, l.stock_item_id)
    item.quantity += l.qty
    db.session.commit()
    return jsonify({"ok": True})


@app.post("/api/public/loan")
def public_loan():
    d = request.get_json() or {}
    v_id = int(d.get("volunteer_id"))
    s_id = int(d.get("stock_item_id"))
    qty = int(d.get("qty") or 1)
    item = db.session.get(StockItem, s_id)
    if not item or item.quantity < qty:
        return jsonify({"ok": False, "error": "Stock insuffisant"}), 400
    item.quantity -= qty
    db.session.add(Loan(volunteer_id=v_id, stock_item_id=s_id, qty=qty))
    db.session.commit()
    return jsonify({"ok": True})


# =========================
# EXPORT CSV
# =========================
@app.get("/api/export/stock.csv")
@login_required
def export_stock_csv():
    si = StringIO()
    w = csv.writer(si, delimiter=';')
    w.writerow(["id","type","antenne","taille","quantite"])
    for s in StockItem.query.all():
        w.writerow([s.id, s.garment_type.label, s.antenna.name, s.size or "", s.quantity])
    return Response(si.getvalue(), mimetype="text/csv",
                    headers={"Content-Disposition": "attachment; filename=stock.csv"})


@app.get("/api/export/loans.csv")
@login_required
def export_loans_csv():
    si = StringIO()
    w = csv.writer(si, delimiter=';')
    w.writerow(["id","benevole","type","taille","antenne","quantite","depuis"])
    for l in Loan.query.filter(Loan.returned_at.is_(None)).all():
        w.writerow([
            l.id,
            f"{l.volunteer.last_name} {l.volunteer.first_name}",
            l.stock_item.garment_type.label,
            l.stock_item.size or "",
            l.stock_item.antenna.name,
            l.qty,
            l.created_at.isoformat(),
        ])
    return Response(si.getvalue(), mimetype="text/csv",
                    headers={"Content-Disposition": "attachment; filename=loans.csv"})


# =========================
# DEBUG / ASSISTANCE
# =========================
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


# =========================
# MAIN
# =========================
if __name__ == "__main__":
    app.run(host="0.0.0.0", port=8000, debug=True)

