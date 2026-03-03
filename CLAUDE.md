# Frame TV Art — Claude Rules

## Temporary files in Flask routes

Flask runs with `threaded=True`. Never use a fixed filename for temp files
inside request handlers — concurrent uploads would corrupt each other.

**Wrong:**
```python
temp_path = os.path.join(UPLOAD_FOLDER, 'upload_temp.jpg')
img.save(temp_path, ...)
```

**Correct — unique file per request:**
```python
fd, temp_path = tempfile.mkstemp(suffix='.jpg', dir=UPLOAD_FOLDER)
os.close(fd)
try:
    img.save(temp_path, ...)
    ...
finally:
    if os.path.exists(temp_path):
        os.remove(temp_path)
```

Always `import tempfile` at the top of `app.py`.
