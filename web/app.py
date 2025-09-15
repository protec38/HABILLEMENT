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

# ===== CSRF =====
# Ajout pour activer la protection CSRF via cookie + header
from flask_wtf.csrf import CSRFProtect, generate_csrf, CSRFError

app = Flask(__name__, template_folder="templates", static_folder="static")

# ---------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------
app.config["SQLALCHEMY_DATABASE_URI"] = os.environ.get("DATABASE_URL")
app.config["SECRET_KEY"] = os.environ.get("SECRET_KEY", "change")
app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False
app.config["SESSION_COOKIE_SAMESITE"] = os.environ.get("SESSION_COOKIE_SAMESITE", "Lax")
app.config["SESSION_COOKIE_SECURE"] = os.environ.get("SESSION_COOKIE_SECURE", "false").lower() == "true"

# ---- CSRF protection ----
csrf = CSRFProtect(app)
# pas d’expiration stricte (utile pour SPA)
app.config.setdefault("WTF_CSRF_TIME_LIMIT", None)
app.config.setdefault("WTF_CSRF_CHECK_DEFAULT", True)

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
# DB bootstrapping
# ---------------------------------------------------------------------
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
    # Migrations idempotentes
    try:
        db.session.execute(text("ALTER TABLE stock_items ADD COLUMN IF NOT EXISTS tags_text TEXT DEFAULT ''"))
        db.session.execute(text("ALTER TABLE antennas ADD COLUMN IF NOT EXISTS low_stock_threshold INTEGER"))
        db.session.execute(text("ALTER TABLE antennas ADD COLUMN IF NOT EXISTS lat DOUBLE PRECISION"))
        db.session.execute(text("ALTER TABLE antennas ADD COLUMN IF NOT EXISTS lng DOUBLE PRECISION"))
        db.session.commit()
    except Exception:
        db.session.rollback()
    # Admin par défaut
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

# ===== CSRF : set cookie à chaque réponse + handler d’erreur JSON =====
@app.after_request
def set_csrf_cookie(resp):
    try:
        token = generate_csrf()
        resp.set_cookie(
            "XSRF-TOKEN",
            token,
            secure=app.config.get("SESSION_COOKIE_SECURE", False),
            httponly=False,  # doit être lisible par JS
            samesite=app.config.get("SESSION_COOKIE_SAMESITE", "Lax"),
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

# ---------------------------------------------------------------------
# Stats
# ---------------------------------------------------------------------
@app.get("/api/stats")
@login_required
def stats():
    stock_total = db.session.query(db.func.coalesce(db.func.sum(StockItem.quantity), 0)).scalar()
    loans_open = Loan.query.filter(Loan.returned_at.is_(None)).count()
    volunteers = Volunteer.query.count()
    return jsonify({"stock_total": int(stock_total or 0), "prets_ouverts": loans_open, "benevoles": volunteers})

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
    return jsonify({"ok": True, "id": a.id})

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
    a.low_stock_threshold = d.get("low_stock_threshold") if "low_stock_threshold" in d else a.low_stock_threshold
    a.lat = d.get("lat") if "lat" in d else a.lat
    a.lng = d.get("lng") if "lng" in d else a.lng
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
    # Vérifie si l'utilisateur est référencé dans des inventaires
    if InventorySession.query.filter_by(user_id=user_id).first():
        return jsonify({"ok": False, "error": "Impossible : l'utilisateur est lié à des inventaires."}), 400
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

@app.delete("/api/types/<int:type_id>")
@login_required
def types_delete(type_id):
    t = db.session.get(GarmentType, type_id)
    if not t:
        return jsonify({"ok": False}), 404
    if StockItem.query.filter_by(garment_type_id=type_id).first():
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
    before = s.quantity
    s.garment_type_id = int(d.get("garment_type_id", s.garment_type_id))
    s.antenna_id = int(d.get("antenna_id", s.antenna_id))
    s.size = d.get("size", s.size)
    if "quantity" in d:
        s.quantity = int(d["quantity"])
    if "tags" in d:
        s.tags_text = tags_to_text(d.get("tags"))
    db.session.commit()
    log_action("stock.update", "stock", item_id, f"{before}->{s.quantity}")
    return jsonify({"ok": True})

@app.delete("/api/stock/<int:item_id>")
@login_required
def stock_delete(item_id):
    s = db.session.get(StockItem, item_id)
    if not s:
        return jsonify({"ok": False}), 404
    # Bloque si des prêts existent (ouverts ou historiques)
    if Loan.query.filter_by(stock_item_id=item_id).first():
        return jsonify({"ok": False, "error": "Impossible : cet article a des prêts associés."}), 400
    try:
        db.session.delete(s)
        db.session.commit()
    except IntegrityError:
        db.session.rollback()
        return jsonify({"ok": False, "error": "Suppression refusée (contraintes liées)."}), 400
    log_action("stock.delete", "stock", item_id, "delete")
    return jsonify({"ok": True})

# ===== Export Stock CSV (UTF-8 BOM; sep=;) =====
@app.get("/api/stock/export.csv")
@login_required
def stock_export_csv():
    sio = StringIO()
    w = csv.writer(sio, delimiter=';', lineterminator='\n')
    w.writerow(["Antenne", "Type", "Taille", "Quantité", "Tags"])
    for s in StockItem.query.order_by(StockItem.id).all():
        w.writerow([
            s.antenna.name if s.antenna else s.antenna_id,
            s.garment_type.label if s.garment_type else s.garment_type_id,
            s.size or "",
            s.quantity or 0,
            ",".join(text_to_tags(s.tags_text)) if s.tags_text else ""
        ])
    data = "\ufeff" + sio.getvalue()  # BOM pour Excel
    resp = Response(data, mimetype="text/csv; charset=utf-8")
    resp.headers["Content-Disposition"] = f'attachment; filename="stock_{datetime.utcnow().strftime("%Y-%m-%d")}.csv"'
    return resp

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
    # Bloque si des prêts sont liés
    if Loan.query.filter_by(volunteer_id=vol_id).first():
        return jsonify({"ok": False, "error": "Impossible : ce bénévole a des prêts associés."}), 400
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

    try:
        from csv import Sniffer
        dialect = Sniffer().sniff(text_data.splitlines()[0])
        delim = dialect.delimiter
    except Exception:
        delim = ";" if text_data.count(";") >= text_data.count(",") else ","

    reader = csv.reader(StringIO(text_data), delimiter=delim)
    rows = list(reader)
    if not rows:
        return jsonify({"ok": False, "error": "Fichier vide"}), 400

    header = [h.strip().lower() for h in rows[0]]

    def _col(*names):
        for n in names:
            if n in header:
                return header.index(n)
        return None

    idx_nom = _col("nom", "lastname", "last name")
    idx_pren = _col("prénom", "prenom", "firstname", "first name")
    idx_note = _col("note", "infos", "info")
    if idx_nom is None or idx_pren is None:
        return jsonify({"ok": False, "error": "Colonnes requises: Nom, Prénom"}), 400

    existing = set((v.last_name.strip().lower(), v.first_name.strip().lower()) for v in Volunteer.query.all())
    added = 0
    skipped = 0
    for r in rows[1:]:
        if not r or all(not c.strip() for c in r):
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
    log_action("loan.return", "loan", loan_id, f"+{l.qty} to stock_item={l.stock_item_id}")
    return jsonify({"ok": True})

# ---------------------------------------------------------------------
# Public (QR) + filtres
# ---------------------------------------------------------------------
@app.get("/api/public/volunteer")
def public_find():
    fn = (request.args.get("first_name", "")).strip()
    ln = (request.args.get("last_name", "")).strip()
    v = Volunteer.query.filter(
        db.func.lower(Volunteer.first_name) == db.func.lower(fn),
        db.func.lower(Volunteer.last_name) == db.func.lower(ln),
    ).first()
    if not v:
        return jsonify({"ok": False, "error": "Bénévole introuvable"}), 404
    return jsonify({"ok": True, "id": v.id, "first_name": v.first_name, "last_name": v.last_name, "note": v.note})

@app.get("/api/public/stock")
def public_stock():
    ant = request.args.get("antenna_id", type=int)
    type_id = request.args.get("type_id", type=int)
    size = request.args.get("size")
    q = StockItem.query.filter(StockItem.quantity > 0)
    if ant: q = q.filter(StockItem.antenna_id == ant)
    if type_id: q = q.filter(StockItem.garment_type_id == type_id)
    if size: q = q.filter(StockItem.size == size)
    data = [{"id": s.id, "type": s.garment_type.label, "size": s.size, "quantity": s.quantity} for s in q.all()]
    return jsonify(data)

@app.get("/api/public/types")
def public_types():
    """Liste des types disponibles (option antenne) pour alimenter le filtre public."""
    antenna_id = request.args.get("antenna_id", type=int)
    q = db.session.query(StockItem.garment_type_id, GarmentType.label).join(GarmentType, StockItem.garment_type_id == GarmentType.id).filter(StockItem.quantity > 0)
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
    item.quantity -= qty
    loan = Loan(volunteer_id=v_id, stock_item_id=s_id, qty=qty)
    db.session.add(loan); db.session.commit()
    log_action("loan.create", "loan", loan.id, f"-{qty} from stock_item={s_id} by volunteer={v_id}")
    return jsonify({"ok": True})

# ---------------------------------------------------------------------
# Inventaire
# ---------------------------------------------------------------------
@app.post("/api/inventory/start")
@login_required
def inventory_start():
    d = request.get_json() or {}
    ant = int(d.get("antenna_id") or 0)
    if not ant: return jsonify({"ok": False, "error": "antenna_id requis"}), 400
    sess = InventorySession(antenna_id=ant, user_id=current_user.id)
    db.session.add(sess); db.session.commit()
    log_action("inventory.start", "inventory", sess.id, f"antenna={ant}")
    return jsonify({"id": sess.id})

@app.get("/api/inventory/<int:sid>/items")
@login_required
def inventory_items(sid):
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
