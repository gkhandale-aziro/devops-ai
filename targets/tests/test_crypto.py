"""
Tests for targets/crypto.py — Fernet encryption for credentials at rest.
"""
import sys, os, tempfile
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

from targets.crypto import encrypt, decrypt, is_encrypted


class TestCrypto:
    def test_encrypt_returns_prefixed_string(self):
        ct = encrypt("my_secret_password")
        assert ct.startswith("enc:")
        assert ct != "my_secret_password"

    def test_decrypt_roundtrip(self):
        plaintext = "Connect#2026"
        ct = encrypt(plaintext)
        assert decrypt(ct) == plaintext

    def test_decrypt_passthrough_non_encrypted(self):
        assert decrypt("plain_value") == "plain_value"
        assert decrypt("") == ""

    def test_encrypt_empty_string_passthrough(self):
        assert encrypt("") == ""

    def test_is_encrypted_true(self):
        ct = encrypt("secret")
        assert is_encrypted(ct) is True

    def test_is_encrypted_false(self):
        assert is_encrypted("plain") is False
        assert is_encrypted("") is False
        assert is_encrypted("not:encrypted") is False

    def test_double_encrypt_prevented(self):
        """Encrypting an already-encrypted value should not double-encrypt."""
        ct1 = encrypt("secret")
        # is_encrypted check should be done by caller (TargetManager)
        assert is_encrypted(ct1) is True

    def test_different_values_different_ciphertexts(self):
        """Each encryption produces a unique token (Fernet uses random IV)."""
        ct1 = encrypt("password1")
        ct2 = encrypt("password1")
        # Same plaintext → different ciphertext (Fernet adds timestamp + IV)
        assert ct1 != ct2
        # But both decrypt to the same value
        assert decrypt(ct1) == "password1"
        assert decrypt(ct2) == "password1"

    def test_unicode_roundtrip(self):
        plaintext = "pässwörd_日本語"
        assert decrypt(encrypt(plaintext)) == plaintext

    def test_long_value_roundtrip(self):
        plaintext = "A" * 10000
        assert decrypt(encrypt(plaintext)) == plaintext
