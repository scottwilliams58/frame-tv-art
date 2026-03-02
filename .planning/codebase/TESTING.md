# Testing

Codebase: `/Users/scottwilliams/Documents/Claude Code/frame-tv-art`

---

## Current State

There are no automated tests in this repository. No test files, no test runner configuration, and no testing libraries appear in `requirements.txt` or anywhere in the project tree. The codebase is a single-file Flask application (`app.py`) with a vanilla-JS frontend (`static/js/app.js`) and no test infrastructure of any kind.

---

## Recommended Test Framework

Given the stack (Flask + Python), the conventional choice is **pytest** with **Flask's built-in test client**.

```
pytest
pytest-flask   # optional but provides the `client` fixture
```

Add to `requirements.txt` (dev-only section or a separate `requirements-dev.txt`):

```
pytest>=8.0
pytest-flask>=1.3
```

---

## What to Test

### Unit-testable functions in `app.py`

These pure or near-pure functions have no external dependencies and are the highest-value targets for unit tests:

| Function | File | What to assert |
|----------|------|----------------|
| `validate_ip` | `app.py:46` | Valid IPv4, valid IPv6, empty string, hostname, CIDR notation — all return correct bool |
| `validate_matte_id` | `app.py:58` | `'none'`, alphanumeric IDs, hyphens/underscores allowed; spaces, slashes, `..` rejected |
| `validate_content_id` | `app.py:62` | Non-empty alphanumeric passes; empty string, spaces, special chars fail |
| `validate_artmode_settings` | `app.py:71` | Each field validated independently; bad brightness (0, 11, string), unknown color temp, non-bool shuffle; valid payload returns `[]` |
| `_err` | `app.py:99` | Returns `{'success': False, 'error': msg}`; exc is not leaked into the return value |
| `with_retry` | `app.py:135` | Succeeds on first attempt; retries on timeout/connection errors; does not retry on other errors; raises after `retries` exhausted |
| `formatMatteName` (JS) | `static/js/app.js:97` | `"modern_white_01"` → `"Modern White"`; trailing `_01` stripped; underscores → spaces; title case |

### Integration tests (Flask routes)

Use Flask's test client to verify the full request/response cycle without hitting a real TV. The `samsungtvws` library and `PIL.Image` need to be mocked.

Routes to cover:

| Route | Method | Key scenarios |
|-------|--------|--------------|
| `GET /` | — | Returns 200, renders template |
| `POST /api/connect` | POST | Missing IP → 200 + `success:false`; invalid IP → same; valid IP (mocked TV) → `success:true` + `art_supported` |
| `POST /api/upload` | POST | Missing IP; invalid matte; base64 image too large (mock DecompressionBombError); valid upload succeeds |
| `GET /api/artworks` | GET | Missing IP; valid IP returns list |
| `POST /api/select` | POST | Invalid content_id rejected; valid call passes through |
| `POST /api/artmode` | POST | Invalid mode rejected; `on`/`off` accepted |
| `GET /api/artmode/settings` | GET | Returns normalized settings dict |
| `POST /api/artmode/settings` | POST | Validation errors returned; motion/sensor fields separated correctly |
| `GET /api/mattes` | GET | Returns matte list |

---

## Recommended File Structure

```
frame-tv-art/
  tests/
    __init__.py
    conftest.py          # pytest fixtures: app, client, mock_art
    test_validators.py   # Pure-function unit tests
    test_routes.py       # Flask integration tests (mocked TV)
    test_retry.py        # with_retry behavior
```

---

## Example Test Patterns

### Validator unit tests

```python
# tests/test_validators.py
import pytest
from app import validate_ip, validate_matte_id, validate_content_id, validate_artmode_settings

class TestValidateIp:
    def test_valid_ipv4(self):
        assert validate_ip('192.168.1.100') is True

    def test_valid_ipv6(self):
        assert validate_ip('::1') is True

    def test_hostname_rejected(self):
        assert validate_ip('myrouter.local') is False

    def test_empty_string_rejected(self):
        assert validate_ip('') is False

    def test_cidr_rejected(self):
        assert validate_ip('192.168.1.0/24') is False


class TestValidateArtmodeSettings:
    def test_valid_payload_returns_no_errors(self):
        errors = validate_artmode_settings({
            'brightness': 5,
            'shuffle': True,
            'color': 'natural',
            'motion_timer': '30',
            'motion_sensitivity': '2',
            'brightness_sensor': False,
        })
        assert errors == []

    def test_brightness_out_of_range(self):
        errors = validate_artmode_settings({'brightness': 11})
        assert any('brightness' in e for e in errors)

    def test_invalid_color_temp(self):
        errors = validate_artmode_settings({'color': 'blue'})
        assert any('color' in e for e in errors)

    def test_shuffle_must_be_bool(self):
        errors = validate_artmode_settings({'shuffle': 'yes'})
        assert any('shuffle' in e for e in errors)
```

### Flask route tests with mocked TV

```python
# tests/conftest.py
import pytest
from unittest.mock import MagicMock, patch
import app as app_module

@pytest.fixture
def flask_app():
    app_module.app.config['TESTING'] = True
    return app_module.app

@pytest.fixture
def client(flask_app):
    return flask_app.test_client()

@pytest.fixture
def mock_art():
    """Return a pre-configured MagicMock for SamsungTVArt."""
    art = MagicMock()
    art.__enter__ = MagicMock(return_value=art)
    art.__exit__ = MagicMock(return_value=False)
    art.supported.return_value = True
    art.get_artmode.return_value = 'on'
    return art
```

```python
# tests/test_routes.py
import json
from unittest.mock import patch, MagicMock

def post_json(client, url, payload):
    return client.post(url, data=json.dumps(payload),
                       content_type='application/json')

class TestConnect:
    def test_missing_ip_returns_error(self, client):
        rv = post_json(client, '/api/connect', {})
        data = rv.get_json()
        assert data['success'] is False
        assert 'IP' in data['error']

    def test_invalid_ip_returns_error(self, client):
        rv = post_json(client, '/api/connect', {'ip': 'not-an-ip'})
        data = rv.get_json()
        assert data['success'] is False

    def test_successful_connect(self, client, mock_art):
        with patch('app.get_art', return_value=mock_art):
            rv = post_json(client, '/api/connect', {'ip': '192.168.1.10'})
        data = rv.get_json()
        assert data['success'] is True
        assert data['art_supported'] is True

class TestArtmodeSettings:
    def test_invalid_settings_returns_error(self, client):
        rv = post_json(client, '/api/artmode/settings', {
            'ip': '192.168.1.10',
            'settings': {'brightness': 99},
        })
        data = rv.get_json()
        assert data['success'] is False
        assert 'brightness' in data['error']
```

### Retry behavior tests

```python
# tests/test_retry.py
import time
import pytest
from unittest.mock import MagicMock
from app import with_retry

class TestWithRetry:
    def test_succeeds_on_first_call(self):
        fn = MagicMock(return_value='ok')
        result = with_retry(fn, retries=2, delay=0)
        assert result == 'ok'
        assert fn.call_count == 1

    def test_retries_on_timeout_error(self):
        fn = MagicMock(side_effect=[
            ConnectionError('timeout'),
            ConnectionError('timeout'),
            'ok',
        ])
        result = with_retry(fn, retries=2, delay=0)
        assert result == 'ok'
        assert fn.call_count == 3

    def test_does_not_retry_on_value_error(self):
        fn = MagicMock(side_effect=ValueError('bad input'))
        with pytest.raises(ValueError):
            with_retry(fn, retries=2, delay=0)
        assert fn.call_count == 1

    def test_raises_after_exhausting_retries(self):
        fn = MagicMock(side_effect=TimeoutError('connection timeout'))
        with pytest.raises(TimeoutError):
            with_retry(fn, retries=2, delay=0)
        assert fn.call_count == 3
```

---

## Mocking Strategy

### `samsungtvws.SamsungTVArt`

The library is imported lazily inside `get_art()`. Mock `app.get_art` at the module level to return a pre-built `MagicMock` that satisfies the context manager protocol:

```python
with patch('app.get_art', return_value=mock_art):
    ...
```

### `PIL.Image`

For upload tests, mock `PIL.Image.open` to return a `MagicMock` image or raise `DecompressionBombError`:

```python
with patch('app.Image.open') as mock_open:
    mock_open.return_value.format = 'JPEG'
    mock_open.return_value.convert.return_value = mock_image
    ...
```

### `time.sleep`

Patch `app.time.sleep` in retry tests to keep tests fast:

```python
with patch('app.time.sleep'):
    ...
```

---

## Running Tests

Once pytest is installed:

```bash
# From the project root
cd "/Users/scottwilliams/Documents/Claude Code/frame-tv-art"

# Run all tests
pytest tests/

# Run with verbose output
pytest -v tests/

# Run a specific file
pytest tests/test_validators.py

# Run with coverage (requires pytest-cov)
pytest --cov=app --cov-report=term-missing tests/
```

---

## Coverage Targets

| Module | Priority | Notes |
|--------|----------|-------|
| `validate_ip` | High | Pure function, edge-case rich |
| `validate_artmode_settings` | High | Most complex validator, many fields |
| `_err` | Medium | Simple but security-relevant |
| `with_retry` | High | Core reliability mechanism |
| All route happy paths | High | Ensures API contracts hold |
| All route validation rejection paths | High | Security boundary |
| `get_artmode_settings` normalization | Medium | Complex branching on TV response shape |

Target: 80%+ line coverage on `app.py`. The `samsungtvws` library itself is not tested here.

---

## JavaScript Testing

No JS test infrastructure exists. If added, the recommended approach is:

- **Vitest** or **Jest** for unit tests on pure functions (`formatMatteName`, `getSelectedRatio`, `generateThumb`, `autoCropToDataURL`).
- **Playwright** or **Cypress** for end-to-end tests of the UI flow.
- The `api()` helper can be tested by mocking `globalThis.fetch` with `vi.fn()` or `jest.fn()`.

The JS file would need to export individual functions (e.g. via ES module `export`) before unit testing is practical in its current single-script form.
