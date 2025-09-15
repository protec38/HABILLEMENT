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
from sqlalchemy import text, or_
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
    tags_text = db.Column(db.Text, default="")
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

# ---------------------------------------------------------------------
# Boot DB + admin
# ---------------------------------------------------------------------
with app.app_context():
    db.create_all()
    if not User.query.first():
        # crée un compte admin par défaut si vide
        db.session.add(
            User(
                email=os.environ.get("ADMIN_EMAIL", "admin@example.com"),
                name=os.environ.get("ADMIN_NAME", "Admin"),
                pwd_hash=bcrypt.hash(os.environ.get("ADMIN_PASSWORD", "admin123")),
                role="admin",
            )
        )
        db.session.commit()

# ---------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------
def tags_to_text(tags):
    if not tags: return ""
    if isinstance(tags, str):
        return ",".join([t.strip() for t in tags.split(",") if t.strip()])
    return ",".join([str(t).strip() for t in tags if str(t).strip()])

def text_to_tags(txt):
    if not txt: return []
    return [t.strip() for t in str(txt).split(",") if t.strip()]

# ---------------------------------------------------------------------
# Routes de base
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

# ---------------------------------------------------------------------
# Stats
# ---------------------------------------------------------------------
@app.get("/api/stats")
@login_required
def stats():
    stock_total = db.session.query(db.func.coalesce(db.func.sum(StockItem.quantity), 0)).scalar()
    loans_open = Loan.query.filter(Loan.returned_at.is_(None)).count()
    volunteers = Volunteer.query.count()
    return jsonify({"stock_total": stock_total, "prets_ouverts": loans_open, "benevoles": volunteers})

# ---------------------------------------------------------------------
# Antennas
# ---------------------------------------------------------------------
@app.get("/api/antennas")
@login_required
def antennas_list():
    items = Antenna.query.order_by(Antenna.name).all()
    return jsonify([{"id": a.id, "name": a.name, "address": a.address, "low_stock_threshold": a.low_stock_threshold, "lat": a.lat, "lng": a.lng} for a in items])

@app.post("/api/antennas")
@login_required
def antennas_add():
    d = request.get_json() or {}
    name = d.get("name", "").strip()
    if not name:
        return jsonify({"ok": False, "error": "Nom requis"}), 400
    if Antenna.query.filter_by(name=name).first():
        return jsonify({"ok": False, "error": "Cette antenne existe déjà"}), 409
    a = Antenna(name=name, address=d.get("address", "").strip(), low_stock_threshold=d.get("low_stock_threshold"), lat=d.get("lat"), lng=d.get("lng"))
    db.session.add(a)
    db.session.commit()
    log_action("antenna.add", "antenna", a.id, a.name)
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
    a.low_stock_threshold = d.get("low_stock_threshold")
    a.lat = d.get("lat", a.lat)
    a.lng = d.get("lng", a.lng)
    db.session.commit()
    log_action("antenna.update", "antenna", ant_id, a.name)
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
    u = User(email=email, name=d.get("name", "").strip() or email, pwd_hash=bcrypt.hash(d.get("password")), role=d.get("role", "admin"))
    db.session.add(u)
    db.session.commit()
    log_action("user.add", "user", u.id, email)
    return jsonify({"id": u.id})

@app.put("/api/users/<int:uid>")
@login_required
def users_update(uid):
    d = request.get_json() or {}
    u = db.session.get(User, uid)
    if not u:
        return jsonify({"ok": False}), 404
    if "name" in d: u.name = (d.get("name") or "").strip()
    if "password" in d and d.get("password"): u.pwd_hash = bcrypt.hash(d.get("password"))
    if "role" in d: u.role = d.get("role")
    db.session.commit()
    log_action("user.update", "user", uid, u.email)
    return jsonify({"ok": True})

@app.delete("/api/users/<int:uid>")
@login_required
def users_delete(uid):
    u = db.session.get(User, uid)
    if not u:
        return jsonify({"ok": False}), 404
    try:
        db.session.delete(u)
        db.session.commit()
    except IntegrityError:
        db.session.rollback()
        return jsonify({"ok": False, "error": "Suppression refusée (contraintes liées)."}), 400
    return jsonify({"ok": True})

# ---------------------------------------------------------------------
# Garment Types (CRUD + suppression)
# ---------------------------------------------------------------------
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
    if GarmentType.query.filter_by(label=label).first():
        return jsonify({"ok": False, "error": "Ce type existe déjà"}), 409
    t = GarmentType(label=label, has_size=bool(d.get("has_size", True)))
    db.session.add(t)
    db.session.commit()
    return jsonify({"id": t.id})

@app.delete("/api/types/<int:tid>")
@login_required
def types_delete(tid):
    t = db.session.get(GarmentType, tid)
    if not t:
        return jsonify({"ok": False}), 404
    if StockItem.query.filter_by(garment_type_id=tid).first():
        return jsonify({"ok": False, "error": "Impossible : du stock existe pour ce type."}), 400
    try:
        db.session.delete(t)
        db.session.commit()
    except IntegrityError:
        db.session.rollback()
        return jsonify({"ok": False, "error": "Suppression refusée (contraintes liées)."}), 400
    return jsonify({"ok": True})

# ---------------------------------------------------------------------
# Stock (tags)
# ---------------------------------------------------------------------
@app.get("/api/stock")
@login_required
def stock_list():
    out = []
    qry = StockItem.query
    t = request.args.get("type_id", type=int)
    a = request.args.get("antenna_id", type=int)
    if t:
        qry = qry.filter(StockItem.garment_type_id == t)
    if a:
        qry = qry.filter(StockItem.antenna_id == a)
    for s in qry.all():
        out.append(
            {
                "id": s.id,
                "garment_type_id": s.garment_type_id,
                "garment_type": s.garment_type.label,
                "antenna_id": s.antenna_id,
                "antenna": s.antenna.name,
                "size": s.size,
                "quantity": s.quantity,
                "tags": text_to_tags(s.tags_text),
            }
        )
    return jsonify(out)

@app.post("/api/stock")
@login_required
def stock_add():
    d = request.get_json() or {}
    t = int(d.get("garment_type_id"))
    a = int(d.get("antenna_id"))
    size = d.get("size")
    qty = int(d.get("quantity") or 0)
    tags = tags_to_text(d.get("tags"))
    if qty <= 0:
        return jsonify({"ok": False, "error": "quantité > 0 requise"}), 400
    item = StockItem.query.filter_by(garment_type_id=t, antenna_id=a, size=size).first()
    if item:
        item.quantity += qty
        # fusion des tags
        merged = set(text_to_tags(item.tags_text)) | set(text_to_tags(tags))
        item.tags_text = tags_to_text(list(merged))
    else:
        item = StockItem(garment_type_id=t, antenna_id=a, size=size, quantity=qty, tags_text=tags)
        db.session.add(item)
    log_action("stock.add", "stock", getattr(item, "id", None), f"+{qty} type={t} ant={a} size={size}")
    db.session.commit()
    return jsonify({"id": item.id})

@app.put("/api/stock/<int:item_id>")
@login_required
def stock_update(item_id):
    d = request.get_json() or {}
    s = db.session.get(StockItem, item_id)
    if not s:
        return jsonify({"ok": False}), 404
    if "garment_type_id" in d: s.garment_type_id = int(d.get("garment_type_id"))
    if "antenna_id" in d: s.antenna_id = int(d.get("antenna_id"))
    if "size" in d: s.size = d.get("size")
    if "quantity" in d: s.quantity = int(d.get("quantity"))
    if "tags" in d: s.tags_text = tags_to_text(d.get("tags"))
    db.session.commit()
    log_action("stock.update", "stock", item_id, f"qty={s.quantity}")
    return jsonify({"ok": True})

@app.delete("/api/stock/<int:item_id>")
@login_required
def stock_delete(item_id):
    s = db.session.get(StockItem, item_id)
    if not s:
        return jsonify({"ok": False}), 404
    try:
        db.session.delete(s)
        db.session.commit()
    except IntegrityError:
        db.session.rollback()
        return jsonify({"ok": False, "error": "Suppression refusée (contraintes liées)."}), 400
    log_action("stock.delete", "stock", item_id, "delete")
    return jsonify({"ok": True})

# Export CSV du stock
@app.get("/api/stock/export.csv")
@login_required
def stock_export_csv():
    """
    Export CSV du stock, avec filtres optionnels:
      - type_id
      - antenna_id
      - q : recherche (type, taille, antenne, tags)
    Retourne un CSV encodé UTF-8 avec BOM (séparateur ;) pour compatibilité Excel.
    """
    # base query avec jointures pour faciliter la recherche
    qry = StockItem.query.join(GarmentType, StockItem.garment_type).join(Antenna, StockItem.antenna)

    t = request.args.get("type_id", type=int)
    a = request.args.get("antenna_id", type=int)
    q = (request.args.get("q") or "").strip().lower()

    if t:
        qry = qry.filter(StockItem.garment_type_id == t)
    if a:
        qry = qry.filter(StockItem.antenna_id == a)
    if q:
        like = f"%{q}%"
        qry = qry.filter(
            or_(
                db.func.lower(GarmentType.label).like(like),
                db.func.lower(db.func.coalesce(StockItem.size, "")).like(like),
                db.func.lower(Antenna.name).like(like),
                db.func.lower(db.func.coalesce(StockItem.tags_text, "")).like(like),
            )
        )

    # tri stable: antenne, type, taille
    qry = qry.order_by(Antenna.name.asc(), GarmentType.label.asc(), db.func.coalesce(StockItem.size, "").asc())

    # écriture CSV
    si = StringIO()
    w = csv.writer(si, delimiter=';')
    w.writerow(["Antenne", "Type", "Taille", "Quantité", "Tags"])
    for s in qry.all():
        w.writerow([
            s.antenna.name,
            s.garment_type.label,
            s.size or "",
            s.quantity,
            s.tags_text or "",
        ])
    data = si.getvalue().encode("utf-8-sig")
    fname = "stock_export_" + datetime.utcnow().strftime("%Y%m%d") + ".csv"
    return Response(
        data,
        mimetype="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{fname}"'}
    )

# ---------------------------------------------------------------------
# Volunteers (liste + recherche + import CSV + CRUD)
# ---------------------------------------------------------------------
@app.get("/api/volunteers")
@login_required
def volunteers_list():
    q = request.args.get("q", "").strip()
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
    if not v:
        return jsonify({"ok": False}), 404
    try:
        db.session.delete(v)
        db.session.commit()
    except IntegrityError:
        db.session.rollback()
        return jsonify({"ok": False, "error": "Suppression refusée (contraintes liées)."}), 400
    return jsonify({"ok": True})

# Import CSV
@app.get("/api/volunteers/template.csv")
@login_required
def volunteers_template_csv():
    si = StringIO()
    w = csv.writer(si, delimiter=';')
    w.writerow(["Nom", "Prénom", "Note"])
    w.writerow(["DUPONT", "Jean", "Taille M"])
    w.writerow(["MARTIN", "Léa", ""])
    data = si.getvalue().encode("utf-8-sig")
    return Response(
        data, mimetype="text/csv",
        headers={"Content-Disposition": 'attachment; filename="benevoles_modele.csv"'}
    )

@app.post("/api/volunteers/import")
@login_required
def volunteers_import_csv():
    if "file" not in request.files:
        return jsonify({"ok": False, "error": "Aucun fichier fourni"}), 400
    f = request.files["file"]
    filename = secure_filename(f.filename or "import.csv")
    raw = f.read()
    try:
        text_data = raw.decode("utf-8-sig")
    except UnicodeDecodeError:
        text_data = raw.decode("latin-1")

    # lecture CSV ; ou ; détecté automatiquement (simples heuristiques)
    delimiter = ";" if text_data.count(";") >= text_data.count(",") else ","
    r = csv.reader(StringIO(text_data), delimiter=delimiter)
    rows = list(r)

    # détection colonnes
    header = rows[0] if rows else []
    idx_ln = idx_fn = idx_note = None
    for i, h in enumerate(header):
        hh = (h or "").strip().lower()
        if "nom" in hh and idx_ln is None: idx_ln = i
        if ("prenom" in hh or "prénom" in hh) and idx_fn is None: idx_fn = i
        if "note" in hh and idx_note is None: idx_note = i

    body = rows[1:] if len(rows) > 1 else []
    if idx_ln is None or idx_fn is None:
        return jsonify({"ok": False, "error": "Colonnes attendues : Nom ; Prénom ; [Note]"}), 400

    # anti doublons (nom+prénom)
    existing = {(v.last_name.lower(), v.first_name.lower()): True for v in Volunteer.query.all()}
    added = skipped = 0
    for r in body:
        if not r: continue
        ln = (r[idx_ln] or "").strip()
        fn = (r[idx_fn] or "").strip()
        if not ln or not fn: 
            skipped += 1
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

# ---------------------------------------------------------------------
# Loans
# ---------------------------------------------------------------------
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
                "volunteer": f"{l.volunteer.last_name} {l.volunteer.first_name}",
                "qty": l.qty,
                "since": l.created_at.isoformat(),
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
    log_action("loan.return", "loan", loan_id, f"+{l.qty} to stock_item={l.stock_item_id}")
    db.session.commit()
    return jsonify({"ok": True})

# ---------------------------------------------------------------------
# Public (pret antenne + filtres)
# ---------------------------------------------------------------------
@app.get("/api/public/volunteer")
def public_find():
    fn = (request.args.get("first_name", "")).strip()
    ln = (request.args.get("last_name", "")).strip()
    v = Volunteer.query.filter(
        db.func.lower(Volunteer.first_name) == fn.lower(),
        db.func.lower(Volunteer.last_name) == ln.lower()
    ).first()
    if not v: return jsonify({"ok": False}), 404
    return jsonify({"ok": True, "id": v.id, "first_name": v.first_name, "last_name": v.last_name})

@app.get("/api/public/stock")
def public_stock():
    antenna_id = request.args.get("antenna_id", type=int)
    type_id = request.args.get("type_id", type=int)
    size = request.args.get("size", type=str)
    q = StockItem.query.filter(StockItem.quantity > 0)
    if antenna_id: q = q.filter(StockItem.antenna_id == antenna_id)
    if type_id: q = q.filter(StockItem.garment_type_id == type_id)
    if size: q = q.filter(db.func.coalesce(StockItem.size, "") == size.strip())
    res = []
    for s in q.all():
        res.append({"id": s.id, "type": s.garment_type.label, "type_id": s.garment_type_id, "size": s.size, "antenna": s.antenna.name, "antenna_id": s.antenna_id, "quantity": s.quantity})
    return jsonify(res)

@app.get("/api/public/types")
def public_types():
    """Liste des types disponibles (option antenne) pour alimenter le filtre public."""
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
    if not l or l.returned_at: return jsonify({"ok": False}), 404
    l.returned_at = datetime.utcnow()
    item = db.session.get(StockItem, l.stock_item_id)
    item.quantity += l.qty
    db.session.commit()
    log_action("loan.return.public", "loan", loan_id, f"+{l.qty} to stock_item={l.stock_item_id}")
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
    l = Loan(volunteer_id=v_id, stock_item_id=s_id, qty=qty)
    db.session.add(l)
    item.quantity -= qty
    db.session.commit()
    log_action("loan.new.public", "loan", l.id, f"-{qty} from stock_item={s_id}")
    return jsonify({"ok": True, "loan_id": l.id})

# ---------------------------------------------------------------------
# Inventaire (session + comptage + clôture)
# ---------------------------------------------------------------------
@app.post("/api/inventory/start")
@login_required
def inventory_start():
    d = request.get_json() or {}
    ant_id = int(d.get("antenna_id"))
    sess = InventorySession(antenna_id=ant_id, user_id=current_user.id)
    db.session.add(sess); db.session.commit()
    return jsonify({"id": sess.id})

@app.get("/api/inventory/<int:sid>")
@login_required
def inventory_get(sid):
    sess = db.session.get(InventorySession, sid)
    if not sess or sess.closed_at: return jsonify({"ok": False}), 404
    rows = []
    for s in StockItem.query.filter_by(antenna_id=sess.antenna_id).all():
        rows.append({"stock_item_id": s.id, "type": s.garment_type.label, "size": s.size, "quantity": s.quantity})
    return jsonify({"antenna": sess.antenna.name, "rows": rows})

@app.post("/api/inventory/<int:sid>/count")
@login_required
def inventory_count(sid):
    d = request.get_json() or {}
    stock_id = int(d.get("stock_item_id"))
    counted = int(d.get("counted_qty") or 0)
    sess = db.session.get(InventorySession, sid)
    s = db.session.get(StockItem, stock_id)
    if not sess or not s or sess.closed_at: return jsonify({"ok": False}), 404
    line = InventoryLine.query.filter_by(session_id=sid, stock_item_id=stock_id).first()
    if not line:
        line = InventoryLine(session_id=sid, stock_item_id=stock_id, previous_qty=s.quantity)
        db.session.add(line)
    line.counted_qty = counted; line.delta = counted - line.previous_qty
    db.session.commit()
    return jsonify({"ok": True})

@app.post("/api/inventory/<int:sid>/close")
@login_required
def inventory_close(sid):
    sess = db.session.get(InventorySession, sid)
    if not sess or sess.closed_at: return jsonify({"ok": False}), 404
    lines = InventoryLine.query.filter_by(session_id=sid).all()
    for ln in lines:
        item = db.session.get(StockItem, ln.stock_item_id)
        if item:
            item.quantity = ln.counted_qty
    sess.closed_at = datetime.utcnow()
    log_action("inventory.close", "inventory", sid, f"lines={len(lines)}")
    db.session.commit()
    return jsonify({"ok": True})

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
