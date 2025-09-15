import os
import time
import csv
from io import StringIO
from datetime import datetime

from flask import Flask, jsonify, request, render_template, Response, make_response
from flask_sqlalchemy import SQLAlchemy
from flask_login import (
    LoginManager, login_user, login_required, logout_user, current_user, UserMixin
)
from passlib.hash import bcrypt
from sqlalchemy import text, or_
from flask_wtf.csrf import CSRFProtect, generate_csrf, CSRFError
from sqlalchemy.exc import IntegrityError
from werkzeug.utils import secure_filename

app = Flask(__name__, template_folder="templates", static_folder="static")

# ---------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------
app.config["SQLALCHEMY_DATABASE_URI"] = os.environ.get("DATABASE_URL")
app.config["SECRET_KEY"] = os.environ.get("SECRET_KEY", "change")
app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False
app.config["SESSION_COOKIE_SAMESITE"] = os.environ.get("SESSION_COOKIE_SAMESITE", "Lax")
app.config["SESSION_COOKIE_SECURE"] = os.environ.get("SESSION_COOKIE_SECURE", "false").lower() == "true"

# --- CSRF Protection ---
csrf = CSRFProtect(app)
app.config.setdefault("WTF_CSRF_TIME_LIMIT", None)
app.config.setdefault("WTF_CSRF_CHECK_DEFAULT", True)  # applies to unsafe methods
app.config.setdefault("SESSION_COOKIE_SAMESITE", app.config.get("SESSION_COOKIE_SAMESITE", "Strict"))

db = SQLAlchemy(app)
login_manager = LoginManager(app)
login_manager.login_view = "index"

# ---------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------
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
    low_stock_threshold = db.Column(db.Integer)   # nullable
    lat = db.Column(db.Float)
    lng = db.Column(db.Float)

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
    # tags stockés en texte (csv)
    tags = db.Column(db.String(255), default="")
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    antenna = db.relationship(Antenna)
    garment_type = db.relationship(GarmentType)

class Volunteer(db.Model):
    __tablename__ = "volunteers"
    id = db.Column(db.Integer, primary_key=True)
    first_name = db.Column(db.String(80), nullable=False)
    last_name = db.Column(db.String(80), nullable=False)
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

# Logs & inventaire
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
    counted_qty = db.Column(db.Integer, default=0)
    session = db.relationship(InventorySession)
    stock_item = db.relationship(StockItem)

@login_manager.user_loader
def load_user(user_id):
    return db.session.get(User, int(user_id))

# ---------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------
def audit(action, entity, entity_id, details=""):
    actor = current_user.email if current_user.is_authenticated else "public"
    db.session.add(Log(actor=actor, action=action, entity=entity, entity_id=entity_id, details=details))
    db.session.commit()

# ---------------------------------------------------------------------
# Routes Front
# ---------------------------------------------------------------------
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

# -- CSRF cookie + handler d'erreur JSON --
@app.after_request
def set_csrf_cookie(resp):
    try:
        token = generate_csrf()
        resp.set_cookie(
            "XSRF-TOKEN",
            token,
            secure=app.config.get("SESSION_COOKIE_SECURE", False),
            httponly=False,
            samesite=app.config.get("SESSION_COOKIE_SAMESITE", "Strict"),
            path="/"
        )
    finally:
        return resp

@app.errorhandler(CSRFError)
def handle_csrf_error(e):
    return jsonify({"ok": False, "error": "CSRF: " + (e.description or "token invalide")}), 400

# ---------------------------------------------------------------------
# Auth
# ---------------------------------------------------------------------
@app.get("/api/me")
def me():
    if current_user.is_authenticated:
        u = current_user
        return jsonify({"ok": True, "user": {"id": u.id, "email": u.email, "name": u.name, "role": u.role}})
    return jsonify({"ok": False}), 401

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

# ---------------------------------------------------------------------
# Antennas
# ---------------------------------------------------------------------
@app.get("/api/antennas")
@login_required
def antennas_list():
    res = []
    for a in Antenna.query.order_by(Antenna.name).all():
        res.append({"id": a.id, "name": a.name, "address": a.address, "low_stock_threshold": a.low_stock_threshold})
    return jsonify(res)

@app.post("/api/antennas")
@login_required
def antennas_add():
    d = request.get_json() or {}
    name = (d.get("name") or "").strip()
    if not name:
        return jsonify({"ok": False, "error": "Nom requis"}), 400
    a = Antenna(name=name, address=d.get("address", "").strip())
    db.session.add(a); db.session.commit()
    audit("antenna_add", "antenna", a.id, a.name)
    return jsonify({"id": a.id})

@app.put("/api/antennas/<int:ant_id>")
@login_required
def antennas_update(ant_id):
    d = request.get_json() or {}
    a = db.session.get(Antenna, ant_id)
    if not a:
        return jsonify({"ok": False}), 404
    a.name = d.get("name", a.name).strip()
    a.address = d.get("address", a.address).strip()
    if "low_stock_threshold" in d:
        a.low_stock_threshold = d.get("low_stock_threshold")
    db.session.commit()
    audit("antenna_update", "antenna", a.id, a.name)
    return jsonify({"ok": True})

@app.delete("/api/antennas/<int:ant_id>")
@login_required
def antennas_delete(ant_id):
    a = db.session.get(Antenna, ant_id)
    if not a:
        return jsonify({"ok": False}), 404
    if StockItem.query.filter_by(antenna_id=ant_id).first():
        return jsonify({"ok": False, "error": "Impossible : cette antenne possède du stock."}), 400
    try:
        db.session.delete(a)
        db.session.commit()
    except IntegrityError as e:
        db.session.rollback()
        return jsonify({"ok": False, "error": "Suppression refusée (contraintes liées)."}), 400
    return jsonify({"ok": True})

# ---------------------------------------------------------------------
# Users
# ---------------------------------------------------------------------
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
    u = User(email=email, name=d.get("name", "").strip() or email, pwd_hash=bcrypt.hash(d["password"]))
    db.session.add(u); db.session.commit()
    return jsonify({"id": u.id})

@app.put("/api/users/<int:user_id>")
@login_required
def users_update(user_id):
    d = request.get_json() or {}
    u = db.session.get(User, user_id)
    if not u:
        return jsonify({"ok": False}), 404
    u.name = d.get("name", u.name).strip()
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
    if u.id == current_user.id:
        return jsonify({"ok": False, "error": "Impossible de supprimer votre propre compte."}), 400
    db.session.delete(u)
    db.session.commit()
    return jsonify({"ok": True})

# ---------------------------------------------------------------------
# Types & Stock
# ---------------------------------------------------------------------
@app.get("/api/types")
@login_required
def types_list():
    return jsonify([{"id": t.id, "label": t.label, "has_size": t.has_size} for t in GarmentType.query.order_by(GarmentType.label).all()])

@app.post("/api/types")
@login_required
def types_add():
    d = request.get_json() or {}
    label = (d.get("label") or "").strip()
    if not label:
        return jsonify({"ok": False, "error": "Label requis"}), 400
    t = GarmentType(label=label, has_size=bool(d.get("has_size", True)))
    db.session.add(t); db.session.commit()
    return jsonify({"id": t.id})

@app.delete("/api/types/<int:type_id>")
@login_required
def types_delete(type_id):
    t = db.session.get(GarmentType, type_id)
    if not t:
        return jsonify({"ok": False}), 404
    if StockItem.query.filter_by(garment_type_id=type_id).first():
        return jsonify({"ok": False, "error": "Ce type est utilisé par des articles."}), 400
    db.session.delete(t); db.session.commit()
    return jsonify({"ok": True})

@app.get("/api/stock")
@login_required
def stock_list():
    ant = request.args.get("antenna_id", type=int)
    typ = request.args.get("type_id", type=int)
    size = request.args.get("size")
    q = StockItem.query
    if ant: q = q.filter(StockItem.antenna_id == ant)
    if typ: q = q.filter(StockItem.garment_type_id == typ)
    if size: q = q.filter(StockItem.size == size)
    items = q.order_by(StockItem.id.desc()).all()
    out = []
    for s in items:
        out.append({
            "id": s.id, "antenna_id": s.antenna_id, "antenna": s.antenna.name if s.antenna else s.antenna_id,
            "garment_type_id": s.garment_type_id, "garment_type": s.garment_type.label if s.garment_type else s.garment_type_id,
            "size": s.size, "quantity": s.quantity, "tags": s.tags or ""
        })
    return jsonify(out)

@app.post("/api/stock")
@login_required
def stock_add():
    d = request.get_json() or {}
    s = StockItem(
        garment_type_id=d.get("garment_type_id"),
        antenna_id=d.get("antenna_id"),
        size=d.get("size") or None,
        quantity=int(d.get("quantity") or 0),
        tags=",".join([t.strip() for t in (d.get("tags") or "").split(",") if t.strip()])
    )
    db.session.add(s); db.session.commit()
    audit("stock_add", "stock_item", s.id, f"qty={s.quantity}")
    return jsonify({"id": s.id})

@app.put("/api/stock/<int:item_id>")
@login_required
def stock_update(item_id):
    d = request.get_json() or {}
    s = db.session.get(StockItem, item_id)
    if not s: return jsonify({"ok": False}), 404
    s.garment_type_id = d.get("garment_type_id", s.garment_type_id)
    s.antenna_id = d.get("antenna_id", s.antenna_id)
    s.size = d.get("size", s.size) or None
    if "quantity" in d: s.quantity = int(d.get("quantity") or 0)
    if "tags" in d: s.tags = ",".join([t.strip() for t in (d.get("tags") or "").split(",") if t.strip()])
    db.session.commit()
    audit("stock_update", "stock_item", s.id, f"qty={s.quantity}")
    return jsonify({"ok": True})

@app.delete("/api/stock/<int:item_id>")
@login_required
def stock_delete(item_id):
    s = db.session.get(StockItem, item_id)
    if not s: return jsonify({"ok": False}), 404
    db.session.delete(s); db.session.commit()
    audit("stock_delete", "stock_item", item_id, "")
    return jsonify({"ok": True})

# ---------------------------------------------------------------------
# Volunteers
# ---------------------------------------------------------------------
@app.get("/api/volunteers")
@login_required
def volunteers_list():
    q = (request.args.get("q") or "").strip()
    qry = Volunteer.query
    if q:
        q_lower = f"%{q.lower()}%"
        qry = qry.filter(
            or_(
                db.func.lower(Volunteer.last_name).like(q_lower),
                db.func.lower(Volunteer.first_name).like(q_lower),
                db.func.lower(Volunteer.note).like(q_lower),
            )
        )
    items = qry.order_by(Volunteer.last_name, Volunteer.first_name).all()
    return jsonify([{"id": v.id, "first_name": v.first_name, "last_name": v.last_name, "note": v.note} for v in items])

@app.post("/api/volunteers")
@login_required
def volunteers_add():
    d = request.get_json() or {}
    v = Volunteer(first_name=d.get("first_name", "").strip(), last_name=d.get("last_name", "").strip(), note=d.get("note", "").strip())
    if not v.first_name or not v.last_name:
        return jsonify({"ok": False, "error": "Prénom et nom requis"}), 400
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
    if not v: return jsonify({"ok": False}), 404
    if Loan.query.filter(Loan.volunteer_id == vol_id, Loan.returned_at.is_(None)).first():
        return jsonify({"ok": False, "error": "Bénévole avec prêt en cours"}), 400
    db.session.delete(v); db.session.commit()
    return jsonify({"ok": True})

@app.get("/api/volunteers/template.csv")
@login_required
def volunteers_template_csv():
    si = StringIO()
    w = csv.writer(si, lineterminator="\n")
    w.writerow(["first_name", "last_name", "note"])
    w.writerow(["Jean", "DUPONT", "Poste / taille etc."])
    return Response(si.getvalue(), mimetype="text/csv")

@app.post("/api/volunteers/import")
@login_required
def volunteers_import():
    f = request.files.get("file")
    if not f: return jsonify({"ok": False, "error": "Fichier requis"}), 400
    count = 0
    try:
        content = f.read().decode("utf-8", errors="ignore").splitlines()
        r = csv.DictReader(content)
        for row in r:
            fn = (row.get("first_name") or "").strip()
            ln = (row.get("last_name") or "").strip()
            note = (row.get("note") or "").strip()
            if not fn or not ln: continue
            if not Volunteer.query.filter_by(first_name=fn, last_name=ln).first():
                db.session.add(Volunteer(first_name=fn, last_name=ln, note=note)); count += 1
        db.session.commit()
    except Exception as e:
        db.session.rollback()
        return jsonify({"ok": False, "error": str(e)}), 400
    return jsonify({"ok": True, "imported": count})

# ---------------------------------------------------------------------
# Loans
# ---------------------------------------------------------------------
@app.get("/api/loans/open")
@login_required
def loans_open():
    res = []
    for l in Loan.query.filter(Loan.returned_at.is_(None)).all():
        res.append({
            "id": l.id, "volunteer_id": l.volunteer_id,
            "volunteer": f"{l.volunteer.last_name} {l.volunteer.first_name}",
            "type": l.stock_item.garment_type.label if l.stock_item and l.stock_item.garment_type else l.stock_item.garment_type_id,
            "size": l.stock_item.size if l.stock_item else "",
            "qty": l.qty, "since": l.created_at.isoformat()
        })
    return jsonify(res)

@app.post("/api/loans/return/<int:loan_id>")
@login_required
def loan_return(loan_id):
    l = db.session.get(Loan, loan_id)
    if not l or l.returned_at is not None:
        return jsonify({"ok": False}), 404
    s = db.session.get(StockItem, l.stock_item_id)
    if s: s.quantity += l.qty
    l.returned_at = datetime.utcnow()
    db.session.commit()
    audit("loan_return", "loan", loan_id, "")
    return jsonify({"ok": True})

# ---------------------------------------------------------------------
# Public (page prêt /a/<id>)
# ---------------------------------------------------------------------
@app.get("/api/public/types")
def public_types():
    antenna_id = request.args.get("antenna_id", type=int)
    q = db.session.query(StockItem.garment_type_id, GarmentType.label).join(GarmentType).filter(StockItem.quantity > 0)
    if antenna_id:
        q = q.filter(StockItem.antenna_id == antenna_id)
    seen = {}
    for tid, label in q.all():
        seen[tid] = label
    out = [{"id": tid, "label": label} for tid, label in sorted(seen.items(), key=lambda x: x[1].lower())]
    return jsonify(out)

@app.get("/api/public/sizes")
def public_sizes():
    """Liste des tailles disponibles pour un type (et antenne optionnelle)."""
    type_id = request.args.get("type_id", type=int)
    antenna_id = request.args.get("antenna_id", type=int)
    if not type_id:
        return jsonify([])
    q = StockItem.query.filter(StockItem.quantity > 0, StockItem.garment_type_id == type_id)
    if antenna_id:
        q = q.filter(StockItem.antenna_id == antenna_id)
    sizes = sorted({s.size for s in q.all() if s.size})
    return jsonify(sizes)

@app.get("/api/public/loans")
def public_loans():
    vol_id = request.args.get("volunteer_id", type=int)
    if not vol_id: return jsonify([])
    res = []
    for l in Loan.query.filter(Loan.volunteer_id == vol_id, Loan.returned_at.is_(None)).all():
        res.append({"id": l.id, "qty": l.qty, "since": l.created_at.isoformat(), "type": l.stock_item.garment_type.label, "size": l.stock_item.size, "antenna": l.stock_item.antenna.name})
    return jsonify(res)

@app.post("/api/public/return/<int:loan_id>")
def public_return(loan_id):
    l = db.session.get(Loan, loan_id)
    if not l or l.returned_at is not None:
        return jsonify({"ok": False}), 404
    s = db.session.get(StockItem, l.stock_item_id)
    if s: s.quantity += l.qty
    l.returned_at = datetime.utcnow()
    db.session.commit()
    audit("public_return", "loan", loan_id, "")
    return jsonify({"ok": True})

@app.post("/api/public/loan")
def public_borrow():
    d = request.get_json() or {}
    vol_id = d.get("volunteer_id")
    stock_id = d.get("stock_item_id")
    qty = int(d.get("qty") or 1)
    v = db.session.get(Volunteer, vol_id)
    s = db.session.get(StockItem, stock_id)
    if not v or not s or s.quantity < qty:
        return jsonify({"ok": False, "error": "Stock insuffisant"}), 400
    s.quantity -= qty
    l = Loan(volunteer_id=v.id, stock_item_id=s.id, qty=qty)
    db.session.add(l); db.session.commit()
    audit("public_loan", "loan", l.id, f"vol={v.id}, item={s.id}, qty={qty}")
    return jsonify({"ok": True, "loan_id": l.id})

# ---------------------------------------------------------------------
# Inventaire
# ---------------------------------------------------------------------
@app.post("/api/inventory/start")
@login_required
def inventory_start():
    d = request.get_json() or {}
    ant = d.get("antenna_id")
    if not ant: return jsonify({"ok": False, "error": "Antenne requise"}), 400
    s = InventorySession(antenna_id=ant, user_id=current_user.id)
    db.session.add(s); db.session.commit()
    return jsonify({"id": s.id})

@app.get("/api/inventory/<int:sid>")
@login_required
def inventory_lines(sid):
    s = db.session.get(InventorySession, sid)
    if not s or s.closed_at: return jsonify({"ok": False}), 404
    stock = StockItem.query.filter_by(antenna_id=s.antenna_id).all()
    out = [{"id": i.id, "type": i.garment_type.label, "size": i.size, "quantity": i.quantity} for i in stock]
    return jsonify(out)

@app.post("/api/inventory/<int:sid>/count")
@login_required
def inventory_count(sid):
    d = request.get_json() or {}
    s = db.session.get(InventorySession, sid)
    if not s or s.closed_at: return jsonify({"ok": False}), 404
    stock_id = d.get("stock_item_id")
    counted_qty = int(d.get("counted_qty") or 0)
    line = InventoryLine.query.filter_by(session_id=sid, stock_item_id=stock_id).first()
    if not line:
        line = InventoryLine(session_id=sid, stock_item_id=stock_id, counted_qty=counted_qty)
        db.session.add(line)
    else:
        line.counted_qty = counted_qty
    db.session.commit()
    return jsonify({"ok": True})

@app.post("/api/inventory/<int:sid>/close")
@login_required
def inventory_close(sid):
    s = db.session.get(InventorySession, sid)
    if not s or s.closed_at: return jsonify({"ok": False}), 404
    s.closed_at = datetime.utcnow()
    db.session.commit()
    audit("inventory_close", "inventory_session", sid, "")
    return jsonify({"ok": True})

# ---------------------------------------------------------------------
# Stats (utilisé par le dashboard existant)
# ---------------------------------------------------------------------
@app.get("/api/stats")
@login_required
def stats():
    total_stock = db.session.query(db.func.coalesce(db.func.sum(StockItem.quantity), 0)).scalar() or 0
    prets_ouverts = db.session.query(db.func.count(Loan.id)).filter(Loan.returned_at.is_(None)).scalar() or 0
    benevoles = db.session.query(db.func.count(db.func.distinct(Volunteer.id))).scalar() or 0
    return jsonify({"stock_total": int(total_stock), "prets_ouverts": int(prets_ouverts), "benevoles": int(benevoles)})

# ---------------------------------------------------------------------
# Export stock CSV (UTF-8 BOM; sep=;)
# ---------------------------------------------------------------------
@app.get("/api/stock/export.csv")
@login_required
def stock_export_csv():
    # Query join optional relations
    q = db.session.query(StockItem)
    # Build CSV
    sio = StringIO()
    writer = csv.writer(sio, delimiter=';', lineterminator='\n')
    writer.writerow(["Antenne", "Type", "Taille", "Quantité", "Tags", "Dernière mise à jour"])
    # attempt to resolve names if relationships exist
    for s in q.all():
        antenna = getattr(getattr(s, "antenna", None), "name", None)
        if antenna is None:
            # fallback by looking up antenna table
            ant = db.session.get(Antenna, getattr(s, "antenna_id", None))
            antenna = ant.name if ant else ""
        gtype = getattr(getattr(s, "garment_type", None), "label", None)
        if gtype is None:
            gt = db.session.get(GarmentType, getattr(s, "garment_type_id", None))
            gtype = (gt.label if gt else str(getattr(s, "garment_type_id", "")))
        size = getattr(s, "size", "") or ""
        qty = getattr(s, "quantity", 0) or 0
        tags = getattr(s, "tags", "") or ""
        updated = getattr(s, "updated_at", None)
        updated_str = updated.isoformat() if updated else ""
        writer.writerow([antenna, gtype, size, qty, tags, updated_str])
    data = sio.getvalue()
    data = "\ufeff" + data  # BOM for Excel
    resp = make_response(data)
    resp.headers["Content-Type"] = "text/csv; charset=utf-8"
    resp.headers["Content-Disposition"] = f"attachment; filename=stock_{datetime.utcnow().strftime('%Y-%m-%d')}.csv"
    return resp

# ---------------------------------------------------------------------
# Logs
# ---------------------------------------------------------------------
@app.get("/api/logs")
@login_required
def logs_list():
    limit = min(int(request.args.get("limit", 100)), 1000)
    items = Log.query.order_by(Log.at.desc()).limit(limit).all()
    return jsonify([{
        "id": l.id, "at": l.at.isoformat(), "actor": l.actor, "action": l.action,
        "entity": l.entity, "entity_id": l.entity_id, "details": l.details
    } for l in items])

# ---------------------------------------------------------------------
if __name__ == "__main__":
    app.run(host="0.0.0.0", port=8000, debug=True)
