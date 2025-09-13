import os
from datetime import datetime
from flask import Flask, jsonify, request, render_template
from flask_sqlalchemy import SQLAlchemy
from flask_login import LoginManager, login_user, login_required, logout_user, current_user, UserMixin
from passlib.hash import bcrypt

app = Flask(__name__, template_folder="templates", static_folder="static")
app.config["SQLALCHEMY_DATABASE_URI"] = os.environ.get("DATABASE_URL")
app.config["SECRET_KEY"] = os.environ.get("SECRET_KEY", "change")
app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False
db = SQLAlchemy(app)
login_manager = LoginManager(app)

class User(db.Model, UserMixin):
    id = db.Column(db.Integer, primary_key=True)
    email = db.Column(db.String(255), unique=True, index=True, nullable=False)
    name = db.Column(db.String(120), nullable=False)
    pwd_hash = db.Column(db.String(255), nullable=False)

class Antenna(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(120), unique=True, index=True, nullable=False)
    address = db.Column(db.String(255), default="")

class GarmentType(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    label = db.Column(db.String(120), unique=True, nullable=False)
    has_size = db.Column(db.Boolean, default=True)

class StockItem(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    garment_type_id = db.Column(db.Integer, db.ForeignKey("garment_type.id"), nullable=False)
    antenna_id = db.Column(db.Integer, db.ForeignKey("antenna.id"), nullable=False)
    size = db.Column(db.String(20))
    quantity = db.Column(db.Integer, default=0)
    garment_type = db.relationship(GarmentType)
    antenna = db.relationship(Antenna)

class Volunteer(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    first_name = db.Column(db.String(120), index=True, nullable=False)
    last_name = db.Column(db.String(120), index=True, nullable=False)
    note = db.Column(db.Text, default="")

class Loan(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    volunteer_id = db.Column(db.Integer, db.ForeignKey("volunteer.id"), nullable=False)
    stock_item_id = db.Column(db.Integer, db.ForeignKey("stock_item.id"), nullable=False)
    qty = db.Column(db.Integer, default=1)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    returned_at = db.Column(db.DateTime, nullable=True)
    volunteer = db.relationship(Volunteer)
    stock_item = db.relationship(StockItem)

@login_manager.user_loader
def load_user(uid): return db.session.get(User, int(uid))

with app.app_context():
    db.create_all()
    email = os.environ.get("ADMIN_EMAIL","admin@pc.fr")
    if not User.query.filter_by(email=email).first():
        db.session.add(User(email=email, name=os.environ.get("ADMIN_NAME","Admin"),
                            pwd_hash=bcrypt.hash(os.environ.get("ADMIN_PASSWORD","admin123"))))
        db.session.commit()

@app.route("/")
def index(): return render_template("index.html")

@app.post("/api/login")
def login_api():
    d = request.get_json() or {}
    u = User.query.filter_by(email=(d.get("email") or "").strip().lower()).first()
    if not u or not bcrypt.verify(d.get("password") or "", u.pwd_hash):
        return jsonify({"ok":False, "error":"Invalid"}), 401
    login_user(u); return jsonify({"ok":True, "user":{"id":u.id,"email":u.email,"name":u.name}})

@app.post("/api/logout")
@login_required
def logout_api(): logout_user(); return jsonify({"ok":True})

@app.get("/api/me")
def me(): 
    if current_user.is_authenticated: 
        return jsonify({"ok":True,"user":{"id":current_user.id,"email":current_user.email,"name":current_user.name}})
    return jsonify({"ok":False})

# Stats
@app.get("/api/stats")
@login_required
def stats():
    stock_total = db.session.query(db.func.coalesce(db.func.sum(StockItem.quantity),0)).scalar()
    loans_open = Loan.query.filter(Loan.returned_at.is_(None)).count()
    volunteers = Volunteer.query.count()
    return jsonify({"stock_total":stock_total,"prets_ouverts":loans_open,"benevoles":volunteers})

# Antennas
@app.get("/api/antennas")
@login_required
def antennas_list(): 
    return jsonify([{"id":a.id,"name":a.name,"address":a.address} for a in Antenna.query.order_by(Antenna.name)])

@app.post("/api/antennas")
@login_required
def antennas_add():
    d=request.get_json() or {}
    a=Antenna(name=d.get("name",""), address=d.get("address","")); db.session.add(a); db.session.commit()
    return jsonify({"id":a.id})

# Types
@app.get("/api/types")
@login_required
def types_list(): 
    return jsonify([{"id":t.id,"label":t.label,"has_size":t.has_size} for t in GarmentType.query.order_by(GarmentType.label)])

@app.post("/api/types")
@login_required
def types_add():
    d=request.get_json() or {}
    t=GarmentType(label=d.get("label",""), has_size=bool(d.get("has_size",True))); db.session.add(t); db.session.commit()
    return jsonify({"id":t.id})

# Stock
@app.get("/api/stock")
@login_required
def stock_list():
    out=[]
    for s in StockItem.query.all():
        out.append({"id":s.id,"garment_type_id":s.garment_type_id,"garment_type":s.garment_type.label,"antenna_id":s.antenna_id,"antenna":s.antenna.name,"size":s.size,"quantity":s.quantity})
    return jsonify(out)

@app.post("/api/stock")
@login_required
def stock_add():
    d=request.get_json() or {}
    t=int(d.get("garment_type_id")); a=int(d.get("antenna_id")); size=d.get("size"); qty=int(d.get("quantity") or 0)
    item = StockItem.query.filter_by(garment_type_id=t, antenna_id=a, size=size).first()
    if item: item.quantity += qty
    else: item = StockItem(garment_type_id=t, antenna_id=a, size=size, quantity=qty); db.session.add(item)
    db.session.commit(); return jsonify({"id":item.id})

# Volunteers
@app.get("/api/volunteers")
@login_required
def volunteers_list():
    return jsonify([{"id":v.id,"first_name":v.first_name,"last_name":v.last_name,"note":v.note} for v in Volunteer.query.order_by(Volunteer.last_name, Volunteer.first_name)])

@app.post("/api/volunteers")
@login_required
def volunteers_add():
    d=request.get_json() or {}
    v=Volunteer(first_name=d.get("first_name",""), last_name=d.get("last_name",""), note=d.get("note",""))
    db.session.add(v); db.session.commit(); return jsonify({"id":v.id})

# Loans admin
@app.get("/api/loans/open")
@login_required
def loans_open():
    res=[]; 
    for l in Loan.query.filter(Loan.returned_at.is_(None)).all():
        res.append({"id":l.id,"qty":l.qty,"since":l.created_at.isoformat(),"volunteer":f"{l.volunteer.last_name} {l.volunteer.first_name}","type":l.stock_item.garment_type.label,"size":l.stock_item.size,"antenna":l.stock_item.antenna.name})
    return jsonify(res)

@app.post("/api/loans/return/<int:loan_id>")
@login_required
def loan_return(loan_id):
    l=db.session.get(Loan, loan_id)
    if not l or l.returned_at: return jsonify({"ok":False}),404
    l.returned_at=datetime.utcnow(); item=db.session.get(StockItem,l.stock_item_id); item.quantity += l.qty; db.session.commit(); return jsonify({"ok":True})

# Public
@app.get("/api/public/volunteer")
def public_find():
    fn=(request.args.get("first_name","")).strip(); ln=(request.args.get("last_name","")).strip()
    v=Volunteer.query.filter(db.func.lower(Volunteer.first_name)==fn.lower(), db.func.lower(Volunteer.last_name)==ln.lower()).first()
    if not v: return jsonify({"ok":False}),404
    return jsonify({"ok":True,"id":v.id,"first_name":v.first_name,"last_name":v.last_name})

@app.get("/api/public/stock")
def public_stock():
    res=[]; 
    for s in StockItem.query.filter(StockItem.quantity>0).all():
        res.append({"id":s.id,"type":s.garment_type.label,"size":s.size,"antenna":s.antenna.name,"quantity":s.quantity})
    return jsonify(res)

@app.post("/api/public/loan")
def public_loan():
    d=request.get_json() or {}
    v_id=int(d.get("volunteer_id")); s_id=int(d.get("stock_item_id")); qty=int(d.get("qty") or 1)
    item=db.session.get(StockItem, s_id)
    if not item or item.quantity<qty: return jsonify({"ok":False,"error":"Stock insuffisant"}),400
    item.quantity-=qty; db.session.add(Loan(volunteer_id=v_id, stock_item_id=s_id, qty=qty)); db.session.commit(); return jsonify({"ok":True})

if __name__=="__main__": app.run(host="0.0.0.0", port=8000, debug=True)
