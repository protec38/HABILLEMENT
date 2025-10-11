import os
import time
import csv
from io import StringIO
from datetime import datetime, timedelta

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

DEFAULT_LOW_STOCK_THRESHOLD = int(os.environ.get("DEFAULT_LOW_STOCK_THRESHOLD", "5"))
DASHBOARD_OVERDUE_DAYS = int(os.environ.get("DASHBOARD_OVERDUE_DAYS", "30"))

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
    stock_total = db.session.query(db.func.coalesce(db.func.sum(StockItem.quantity), 0)).scalar() or 0
    loans_open_q = Loan.query.filter(Loan.returned_at.is_(None))
    loans_open = loans_open_q.count()
    volunteers = Volunteer.query.count()
    types_count = GarmentType.query.count()
    antennas_count = Antenna.query.count()
    active_volunteers = (
        db.session.query(db.func.count(db.func.distinct(Loan.volunteer_id)))
        .filter(Loan.returned_at.is_(None))
        .scalar()
        or 0
    )

    antenna_rows = []
    antenna_q = (
        db.session.query(
            Antenna.id,
            Antenna.name,
            Antenna.low_stock_threshold,
            db.func.coalesce(db.func.sum(StockItem.quantity), 0),
        )
        .outerjoin(StockItem)
        .group_by(Antenna.id)
        .order_by(Antenna.name)
    )
    for ant_id, name, threshold, qty in antenna_q:
        antenna_rows.append(
            {
                "id": ant_id,
                "name": name,
                "total_qty": int(qty or 0),
                "threshold": threshold,
                "is_below_threshold": threshold is not None and (qty or 0) <= threshold,
            }
        )

    type_rows = []
    type_q = (
        db.session.query(
            GarmentType.id,
            GarmentType.label,
            db.func.coalesce(db.func.sum(StockItem.quantity), 0),
        )
        .outerjoin(StockItem)
        .group_by(GarmentType.id)
        .order_by(db.func.coalesce(db.func.sum(StockItem.quantity), 0).desc(), GarmentType.label)
    )
    for type_id, label, qty in type_q:
        type_rows.append({"id": type_id, "label": label, "total_qty": int(qty or 0)})

    low_stock_items = []
    low_stock_q = (
        db.session.query(
            StockItem.id,
            GarmentType.label,
            GarmentType.id,
            Antenna.name,
            Antenna.id,
            StockItem.size,
            StockItem.quantity,
            Antenna.low_stock_threshold,
        )
        .join(GarmentType)
        .join(Antenna)
        .filter(
            StockItem.quantity
            <= db.func.coalesce(Antenna.low_stock_threshold, DEFAULT_LOW_STOCK_THRESHOLD)
        )
        .order_by(StockItem.quantity.asc(), GarmentType.label.asc())
        .limit(20)
    )
    for (sid, type_label, type_id, antenna_name, antenna_id, size, qty, threshold) in low_stock_q:
        low_stock_items.append(
            {
                "id": sid,
                "garment_type": type_label,
                "garment_type_id": type_id,
                "antenna": antenna_name,
                "antenna_id": antenna_id,
                "size": size,
                "quantity": int(qty or 0),
                "antenna_threshold": threshold,
            }
        )

    stock_snapshot = []
    stock_q = (
        db.session.query(
            StockItem.id,
            StockItem.quantity,
            StockItem.size,
            StockItem.tags_text,
            StockItem.antenna_id,
            StockItem.garment_type_id,
            GarmentType.label,
            Antenna.name,
        )
        .join(GarmentType)
        .join(Antenna)
    )
    for (sid, qty, size, tags_text, antenna_id, type_id, type_label, antenna_name) in stock_q:
        stock_snapshot.append(
            {
                "id": sid,
                "quantity": int(qty or 0),
                "size": size,
                "tags": text_to_tags(tags_text),
                "antenna_id": antenna_id,
                "antenna": antenna_name,
                "garment_type_id": type_id,
                "garment_type": type_label,
            }
        )

    open_loans_data = []
    for l in loans_open_q.order_by(Loan.created_at.asc()).all():
        open_loans_data.append(
            {
                "id": l.id,
                "qty": l.qty,
                "since": l.created_at.isoformat(),
                "volunteer": f"{l.volunteer.first_name} {l.volunteer.last_name}".strip(),
                "volunteer_id": l.volunteer_id,
                "antenna": l.stock_item.antenna.name,
                "antenna_id": l.stock_item.antenna_id,
                "type": l.stock_item.garment_type.label,
                "garment_type_id": l.stock_item.garment_type_id,
                "size": l.stock_item.size,
            }
        )

    now = datetime.utcnow()
    current_month = datetime(now.year, now.month, 1)
    month_starts = []
    for _ in range(6):
        month_starts.append(current_month)
        current_month = (current_month - timedelta(days=1)).replace(day=1)
    month_starts = list(reversed(month_starts))
    month_keys = [m.strftime("%Y-%m") for m in month_starts]
    created_counts = {k: 0 for k in month_keys}
    returned_counts = {k: 0 for k in month_keys}
    if month_starts:
        earliest = month_starts[0]
        relevant_loans = Loan.query.filter(Loan.created_at >= earliest).all()
        for loan in relevant_loans:
            key = loan.created_at.strftime("%Y-%m")
            if key in created_counts:
                created_counts[key] += 1
            if loan.returned_at:
                rkey = loan.returned_at.strftime("%Y-%m")
                if rkey in returned_counts:
                    returned_counts[rkey] += 1
    loan_activity = []
    for m in month_starts:
        key = m.strftime("%Y-%m")
        loan_activity.append(
            {
                "month": key,
                "label": m.strftime("%b %Y"),
                "created": created_counts.get(key, 0),
                "returned": returned_counts.get(key, 0),
            }
        )

    recent_loans = []
    for loan in Loan.query.order_by(Loan.created_at.desc()).limit(8):
        recent_loans.append(
            {
                "id": loan.id,
                "volunteer": f"{loan.volunteer.first_name} {loan.volunteer.last_name}".strip(),
                "volunteer_id": loan.volunteer_id,
                "type": loan.stock_item.garment_type.label if loan.stock_item else "",
                "garment_type_id": loan.stock_item.garment_type_id if loan.stock_item else None,
                "size": loan.stock_item.size if loan.stock_item else None,
                "antenna": loan.stock_item.antenna.name if loan.stock_item else "",
                "antenna_id": loan.stock_item.antenna_id if loan.stock_item else None,
                "qty": loan.qty,
                "created_at": loan.created_at.isoformat(),
                "returned_at": loan.returned_at.isoformat() if loan.returned_at else None,
            }
        )

    recent_logs = []
    for log in Log.query.order_by(Log.at.desc()).limit(10):
        recent_logs.append(
            {
                "id": log.id,
                "at": log.at.isoformat(),
                "actor": log.actor,
                "action": log.action,
                "entity": log.entity,
                "entity_id": log.entity_id,
                "details": log.details,
            }
        )

    type_options = [
        {"id": t.id, "label": t.label, "has_size": t.has_size}
        for t in GarmentType.query.order_by(GarmentType.label).all()
    ]
    antenna_options = [
        {
            "id": a.id,
            "name": a.name,
            "low_stock_threshold": a.low_stock_threshold,
        }
        for a in Antenna.query.order_by(Antenna.name).all()
    ]

    return jsonify(
        {
            "stock_total": int(stock_total),
            "prets_ouverts": loans_open,
            "benevoles": volunteers,
            "types": types_count,
            "antennas": antennas_count,
            "active_volunteers": active_volunteers,
            "stock_by_antenna": antenna_rows,
            "stock_by_type": type_rows,
            "low_stock_items": low_stock_items,
            "stock_snapshot": stock_snapshot,
            "open_loans": open_loans_data,
            "loan_activity": loan_activity,
            "recent_loans": recent_loans,
            "recent_logs": recent_logs,
            "type_options": type_options,
            "antenna_options": antenna_options,
            "overdue_default": DASHBOARD_OVERDUE_DAYS,
        }
    )

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


@app.get("/api/stock/export")
@login_required
def stock_export():
    qry = StockItem.query.join(GarmentType).join(Antenna)
    t = request.args.get("type_id", type=int)
    a = request.args.get("antenna_id", type=int)
    if t:
        qry = qry.filter(StockItem.garment_type_id == t)
    if a:
        qry = qry.filter(StockItem.antenna_id == a)
    qry = qry.order_by(GarmentType.label.asc(), StockItem.size.asc(), Antenna.name.asc())

    buffer = StringIO()
    writer = csv.writer(buffer, delimiter=";")
    writer.writerow(["Protection Civile - Inventaire des tenues"])
    writer.writerow(["Palette", "Bleu PC #0b3b6e", "Orange PC #f28800"])
    writer.writerow([])
    writer.writerow(["Type", "Taille", "Antenne", "Quantité", "Tags"])
    for s in qry.all():
        tags = text_to_tags(s.tags_text)
        writer.writerow(
            [
                s.garment_type.label,
                s.size or "",
                s.antenna.name,
                s.quantity,
                " | ".join(tags) if tags else "",
            ]
        )

    csv_content = "\ufeff" + buffer.getvalue()
    filename = f"stock_protection_civile_{datetime.utcnow().strftime('%Y%m%d_%H%M')}.csv"
    headers = {"Content-Disposition": f"attachment; filename={filename}"}
    return Response(csv_content, mimetype="text/csv; charset=utf-8", headers=headers)


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
    removed_loans = 0
    loans = Loan.query.filter_by(stock_item_id=item_id).all()
    for loan in loans:
        removed_loans += 1
        log_action("loan.delete.with_stock", "loan", loan.id, f"stock_item={item_id}")
        db.session.delete(loan)

    removed_inventory_lines = 0
    inventory_lines = InventoryLine.query.filter_by(stock_item_id=item_id).all()
    for line in inventory_lines:
        removed_inventory_lines += 1
        log_action("inventory_line.delete.with_stock", "inventory_line", line.id, f"stock_item={item_id}")
        db.session.delete(line)

    try:
        db.session.delete(s)
        log_action(
            "stock.delete",
            "stock",
            item_id,
            f"delete loans={removed_loans} inventory_lines={removed_inventory_lines}",
        )
        db.session.commit()
    except IntegrityError:
        db.session.rollback()
        return jsonify({"ok": False, "error": "Suppression refusée (contraintes liées)."}), 400
    return jsonify({"ok": True, "removed_loans": removed_loans, "removed_inventory_lines": removed_inventory_lines})

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


@app.get("/api/volunteers/export.csv")
@login_required
def volunteers_export_csv():
    si = StringIO()
    writer = csv.writer(si, delimiter=';')
    writer.writerow(["Nom", "Prénom", "Note"])
    for volunteer in Volunteer.query.order_by(Volunteer.last_name, Volunteer.first_name):
        writer.writerow([
            volunteer.last_name or "",
            volunteer.first_name or "",
            volunteer.note or "",
        ])

    data = si.getvalue().encode("utf-8-sig")
    return Response(
        data,
        mimetype="text/csv",
        headers={"Content-Disposition": 'attachment; filename="benevoles_export.csv"'}
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


@app.get("/api/loans/history")
@login_required
def loans_history():
    limit = request.args.get("limit", default=100, type=int)
    limit = max(1, min(limit or 100, 500))
    res = []
    q = Loan.query.order_by(Loan.created_at.desc()).limit(limit)
    for l in q.all():
        res.append(
            {
                "id": l.id,
                "qty": l.qty,
                "created_at": l.created_at.isoformat(),
                "returned_at": l.returned_at.isoformat() if l.returned_at else None,
                "volunteer": f"{l.volunteer.last_name} {l.volunteer.first_name}",
                "type": l.stock_item.garment_type.label,
                "size": l.stock_item.size,
                "antenna": l.stock_item.antenna.name,
            }
        )
    return jsonify(res)

# ---------------------------------------------------------------------
# Public (QR) + filtres
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
