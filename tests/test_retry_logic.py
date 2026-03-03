"""
Tests for TVConnection.execute() retry logic.

Verifies that:
- UnauthorizedError is NOT retried (the regression case — was causing double pairing prompt)
- ConnectionError and TimeoutError ARE retried once
- A successful call returns the function's return value
"""

import sys
import os
import types
import unittest
from unittest.mock import MagicMock, patch

# ---------------------------------------------------------------------------
# Provide a minimal stub for samsungtvws so app.py can be imported without
# the real package installed.
# ---------------------------------------------------------------------------
_samsungtvws_stub = types.ModuleType('samsungtvws')
_samsungtvws_stub.SamsungTVArt = MagicMock  # placeholder class
sys.modules.setdefault('samsungtvws', _samsungtvws_stub)

# Add the project root to sys.path so we can import app directly.
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

import app as app_module  # noqa: E402  (after sys.path manipulation)

TVConnection = app_module.TVConnection


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

class FakeUnauthorizedError(Exception):
    """Mimics samsungtvws.exceptions.UnauthorizedError by class name."""

FakeUnauthorizedError.__name__ = 'UnauthorizedError'


def _make_tv(ip='192.168.1.1'):
    """Return a TVConnection instance without touching the network."""
    tv = TVConnection.__new__(TVConnection)
    tv._art = None
    tv._ip = None
    import threading
    tv._lock = threading.Lock()
    return tv


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

class TestRetryLogic(unittest.TestCase):

    def _run_execute(self, side_effects, *, sleep_mock):
        """
        Helper: patch _connect to raise side_effects in sequence, then call
        execute() and return (call_count, sleep_call_count, result_or_exc).
        """
        tv = _make_tv()
        connect_mock = MagicMock(side_effect=side_effects)

        fn = MagicMock(return_value='ok')

        with patch.object(tv, '_connect', connect_mock):
            try:
                result = tv.execute('192.168.1.1', fn)
                return connect_mock.call_count, sleep_mock.call_count, result
            except Exception as exc:
                return connect_mock.call_count, sleep_mock.call_count, exc

    # --- regression: unauthorized must not be retried -----------------------

    @patch('time.sleep')
    def test_unauthorized_not_retried(self, sleep_mock):
        """UnauthorizedError must propagate immediately — no retry, no sleep."""
        err = FakeUnauthorizedError('ms.channel.unauthorized')
        call_count, sleep_count, outcome = self._run_execute([err], sleep_mock=sleep_mock)

        self.assertEqual(call_count, 1, '_connect should be called exactly once')
        self.assertEqual(sleep_count, 0, 'time.sleep should not be called')
        self.assertIsInstance(outcome, FakeUnauthorizedError)

    # --- normal retriable errors ARE retried once ---------------------------

    @patch('time.sleep')
    def test_connection_error_retried(self, sleep_mock):
        """ConnectionError containing 'connection' should trigger one retry."""
        err = ConnectionError('connection refused')
        call_count, sleep_count, outcome = self._run_execute(
            [err, err], sleep_mock=sleep_mock
        )

        self.assertEqual(call_count, 2, '_connect should be called twice (original + retry)')
        self.assertEqual(sleep_count, 1, 'time.sleep should be called once between retries')
        self.assertIsInstance(outcome, ConnectionError)

    @patch('time.sleep')
    def test_timeout_error_retried(self, sleep_mock):
        """TimeoutError containing 'timeout' should trigger one retry."""
        err = TimeoutError('timeout waiting for response')
        call_count, sleep_count, outcome = self._run_execute(
            [err, err], sleep_mock=sleep_mock
        )

        self.assertEqual(call_count, 2)
        self.assertEqual(sleep_count, 1)
        self.assertIsInstance(outcome, TimeoutError)

    # --- happy path ---------------------------------------------------------

    @patch('time.sleep')
    def test_success_no_retry(self, sleep_mock):
        """A successful call returns the function's value with no retry."""
        tv = _make_tv()
        connect_mock = MagicMock()  # no exception
        fn = MagicMock(return_value='ok')

        with patch.object(tv, '_connect', connect_mock):
            result = tv.execute('192.168.1.1', fn)

        self.assertEqual(result, 'ok')
        self.assertEqual(connect_mock.call_count, 1)
        self.assertEqual(sleep_mock.call_count, 0)


if __name__ == '__main__':
    unittest.main()
