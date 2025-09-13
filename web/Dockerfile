FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1     PYTHONUNBUFFERED=1

WORKDIR /app

RUN pip install --no-cache-dir     Flask==3.0.3 Flask-Login==0.6.3 SQLAlchemy==2.0.30 Flask_SQLAlchemy==3.1.1     psycopg2-binary passlib[bcrypt] gunicorn==22.0.0

COPY . /app

EXPOSE 8000
CMD ["gunicorn","-w","3","-b","0.0.0.0:8000","app:app"]
