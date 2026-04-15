"""
TaskFlow - A Full-Stack Task Management Application
Built with Flask + SQLite + Vanilla JS

Author: Senior Full-Stack Developer
Stack: Python/Flask (Backend), SQLite (DB), HTML/CSS/JS (Frontend)
"""

from flask import Flask, render_template, request, redirect, url_for, session, jsonify
import sqlite3
import hashlib
import os
from datetime import datetime

# ─────────────────────────────────────────────
#  App Configuration
# ─────────────────────────────────────────────
app = Flask(__name__)
app.secret_key = os.urandom(24)  # Secret key for session management

DB_PATH = os.path.join(os.path.dirname(__file__), "database.db")


# ─────────────────────────────────────────────
#  Database Helpers
# ─────────────────────────────────────────────

def get_db():
    """Open a new database connection."""
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row   # Return rows as dict-like objects
    return conn


def init_db():
    """Create tables if they don't exist yet."""
    conn = get_db()
    cur = conn.cursor()

    # Users table
    cur.execute("""
        CREATE TABLE IF NOT EXISTS users (
            id       INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT    UNIQUE NOT NULL,
            password TEXT    NOT NULL
        )
    """)

    # Tasks table – extended with due_date and priority
    cur.execute("""
        CREATE TABLE IF NOT EXISTS tasks (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            task       TEXT    NOT NULL,
            status     TEXT    NOT NULL DEFAULT 'pending',
            due_date   TEXT,
            priority   TEXT    NOT NULL DEFAULT 'medium',
            created_at TEXT    NOT NULL,
            user_id    INTEGER NOT NULL,
            FOREIGN KEY (user_id) REFERENCES users(id)
        )
    """)

    conn.commit()
    conn.close()


def hash_password(password: str) -> str:
    """Hash a plaintext password with SHA-256."""
    return hashlib.sha256(password.encode()).hexdigest()


def login_required(func):
    """Decorator – redirect to login if the user is not authenticated."""
    from functools import wraps

    @wraps(func)
    def wrapper(*args, **kwargs):
        if "user_id" not in session:
            return redirect(url_for("login"))
        return func(*args, **kwargs)

    return wrapper


# ─────────────────────────────────────────────
#  Auth Routes
# ─────────────────────────────────────────────

@app.route("/")
def index():
    """Root: redirect to dashboard (or login if unauthenticated)."""
    if "user_id" in session:
        return redirect(url_for("dashboard"))
    return redirect(url_for("login"))


@app.route("/register", methods=["GET", "POST"])
def register():
    """Handle user registration."""
    error = None

    if request.method == "POST":
        username = request.form.get("username", "").strip()
        password = request.form.get("password", "").strip()

        if not username or not password:
            error = "Username and password are required."
        elif len(password) < 6:
            error = "Password must be at least 6 characters."
        else:
            conn = get_db()
            try:
                conn.execute(
                    "INSERT INTO users (username, password) VALUES (?, ?)",
                    (username, hash_password(password))
                )
                conn.commit()
                return redirect(url_for("login"))
            except sqlite3.IntegrityError:
                error = "Username already exists. Please choose another."
            finally:
                conn.close()

    return render_template("register.html", error=error)


@app.route("/login", methods=["GET", "POST"])
def login():
    """Handle user login."""
    error = None

    if request.method == "POST":
        username = request.form.get("username", "").strip()
        password = request.form.get("password", "").strip()

        conn = get_db()
        user = conn.execute(
            "SELECT * FROM users WHERE username = ? AND password = ?",
            (username, hash_password(password))
        ).fetchone()
        conn.close()

        if user:
            session["user_id"]  = user["id"]
            session["username"] = user["username"]
            return redirect(url_for("dashboard"))
        else:
            error = "Invalid username or password."

    return render_template("login.html", error=error)


@app.route("/logout")
def logout():
    """Clear the session and redirect to login."""
    session.clear()
    return redirect(url_for("login"))


# ─────────────────────────────────────────────
#  Dashboard Route
# ─────────────────────────────────────────────

@app.route("/dashboard")
@login_required
def dashboard():
    """Render the main dashboard with all tasks for the logged-in user."""
    conn = get_db()
    tasks = conn.execute(
        "SELECT * FROM tasks WHERE user_id = ? ORDER BY created_at DESC",
        (session["user_id"],)
    ).fetchall()
    conn.close()

    # Task statistics for the header cards
    total     = len(tasks)
    completed = sum(1 for t in tasks if t["status"] == "completed")
    pending   = total - completed

    return render_template(
        "dashboard.html",
        tasks=tasks,
        username=session["username"],
        total=total,
        completed=completed,
        pending=pending
    )


# ─────────────────────────────────────────────
#  Task API Routes  (JSON endpoints)
# ─────────────────────────────────────────────

@app.route("/api/tasks", methods=["POST"])
@login_required
def create_task():
    """Create a new task for the current user."""
    data     = request.get_json()
    task     = (data.get("task") or "").strip()
    due_date = data.get("due_date", "")
    priority = data.get("priority", "medium")

    if not task:
        return jsonify({"error": "Task description is required."}), 400

    created_at = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    conn = get_db()
    cur  = conn.execute(
        "INSERT INTO tasks (task, status, due_date, priority, created_at, user_id) VALUES (?, 'pending', ?, ?, ?, ?)",
        (task, due_date, priority, created_at, session["user_id"])
    )
    new_id = cur.lastrowid
    conn.commit()
    conn.close()

    return jsonify({
        "id":         new_id,
        "task":       task,
        "status":     "pending",
        "due_date":   due_date,
        "priority":   priority,
        "created_at": created_at
    }), 201


@app.route("/api/tasks/<int:task_id>", methods=["PUT"])
@login_required
def update_task(task_id):
    """Update task text, due date, priority, or toggle status."""
    data     = request.get_json()
    conn     = get_db()

    # Verify the task belongs to the current user
    task_row = conn.execute(
        "SELECT * FROM tasks WHERE id = ? AND user_id = ?",
        (task_id, session["user_id"])
    ).fetchone()

    if not task_row:
        conn.close()
        return jsonify({"error": "Task not found."}), 404

    # Merge existing values with incoming updates
    new_task     = (data.get("task") or task_row["task"]).strip()
    new_status   = data.get("status",   task_row["status"])
    new_due_date = data.get("due_date", task_row["due_date"])
    new_priority = data.get("priority", task_row["priority"])

    conn.execute(
        "UPDATE tasks SET task = ?, status = ?, due_date = ?, priority = ? WHERE id = ?",
        (new_task, new_status, new_due_date, new_priority, task_id)
    )
    conn.commit()
    conn.close()

    return jsonify({"success": True, "status": new_status})


@app.route("/api/tasks/<int:task_id>", methods=["DELETE"])
@login_required
def delete_task(task_id):
    """Delete a task (only if it belongs to the current user)."""
    conn = get_db()
    result = conn.execute(
        "DELETE FROM tasks WHERE id = ? AND user_id = ?",
        (task_id, session["user_id"])
    )
    conn.commit()
    conn.close()

    if result.rowcount == 0:
        return jsonify({"error": "Task not found."}), 404

    return jsonify({"success": True})


# ─────────────────────────────────────────────
#  Entry Point
# ─────────────────────────────────────────────

if __name__ == "__main__":
    init_db()           # Create tables on first run
    app.run(debug=True) # Set debug=False in production
