FROM python:3.11-slim
WORKDIR /app
RUN pip install --no-cache-dir Flask==3.0.3 Flask-Login==0.6.3 SQLAlchemy==2.0.30 Flask_SQLAlchemy==3.1.1 psycopg2-binary passlib[bcrypt]
COPY . /app
EXPOSE 8000
CMD ["python", "app.py"]
