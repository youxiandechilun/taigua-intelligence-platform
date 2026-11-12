"""验证全局品牌图片的权限、内容校验、持久化及默认恢复。"""
import io
from pathlib import Path
import tempfile
import unittest
import sys

from PIL import Image
from werkzeug.security import generate_password_hash

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from team_gateway import create_app
from brand_assets import BrandAssets, MAX_LOGO_BYTES


class BrandingTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.app = create_app(self.temp.name, secure_cookie=False, bootstrap={
            'username': 'brand_admin', 'password_hash': generate_password_hash('Brand-test-2026'),
        })
        self.admin = self.app.test_client()
        self.admin.post('/api/team/login', json={'username': 'brand_admin', 'password': 'Brand-test-2026'})
        self.headers = {'X-CSRF-Token': self.admin.get('/api/team/me').json['data']['csrf']}

    def tearDown(self):
        self.app.extensions['workers'].close()
        self.temp.cleanup()

    def image(self):
        data = io.BytesIO()
        Image.new('RGBA', (400, 80), (183, 50, 64, 255)).save(data, format='PNG')
        data.seek(0)
        return data

    def upload(self, client=None, headers=None, image=None):
        return (client or self.admin).post('/api/team/branding', headers=self.headers if headers is None else headers,
            data={'logo': (image or self.image(), 'logo.png')})

    def test_public_read_admin_save_persistence_and_reset(self):
        anonymous = self.app.test_client()
        default = anonymous.get('/api/team/branding').json['data']
        self.assertFalse(default['is_custom'])
        self.assertEqual(anonymous.get(default['logo_url']).mimetype, 'image/png')
        uploaded = self.upload()
        self.assertEqual(uploaded.status_code, 200)
        self.assertNotEqual(uploaded.json['data']['version'], default['version'])
        self.assertTrue(BrandAssets(self.temp.name).info()['is_custom'])
        self.assertEqual(anonymous.get('/api/team/branding').json['data'], uploaded.json['data'])
        with Image.open(io.BytesIO(anonymous.get(uploaded.json['data']['logo_url']).data)) as image:
            self.assertEqual(image.size, (400, 80))
        restored = self.admin.delete('/api/team/branding', headers=self.headers)
        self.assertEqual(restored.json['data'], default)

    def test_employee_anonymous_and_csrf_cannot_change_brand(self):
        anonymous = self.app.test_client()
        self.assertEqual(self.upload(anonymous, {}).status_code, 401)
        self.assertEqual(self.upload(headers={}).status_code, 403)
        self.assertEqual(self.upload(headers={**self.headers, 'Origin': 'https://elsewhere.example'}).status_code, 403)
        self.admin.post('/api/team/users', headers=self.headers, json={
            'username': 'brand_employee', 'display_name': '员工', 'password': 'Employee-test-2026',
        })
        employee = self.app.test_client()
        employee.post('/api/team/login', json={'username': 'brand_employee', 'password': 'Employee-test-2026'})
        headers = {'X-CSRF-Token': employee.get('/api/team/me').json['data']['csrf']}
        self.assertEqual(self.upload(employee, headers).status_code, 403)
        self.assertEqual(employee.delete('/api/team/branding', headers=headers).status_code, 403)

    def test_bad_uploads_preserve_saved_logo(self):
        self.upload()
        previous = BrandAssets(self.temp.name).info()
        for raw in [b'<svg onload="alert(1)"></svg>', b'not an image', b'x' * (MAX_LOGO_BYTES + 1)]:
            self.assertIn(self.upload(image=io.BytesIO(raw)).status_code, (400, 413))
            self.assertEqual(BrandAssets(self.temp.name).info(), previous)
        transparent = io.BytesIO()
        Image.new('RGBA', (100, 100)).save(transparent, format='PNG'); transparent.seek(0)
        self.assertEqual(self.upload(image=transparent).status_code, 400)

    def test_upload_normalizes_orientation_size_and_metadata(self):
        data = io.BytesIO()
        source = Image.new('RGB', (3000, 600), 'white')
        source.save(data, format='JPEG', exif=b'Exif\x00\x00private-metadata'); data.seek(0)
        self.assertEqual(self.upload(image=data).status_code, 200)
        with Image.open(BrandAssets(self.temp.name).path()) as saved:
            self.assertEqual(saved.size, (1600, 320))
            self.assertFalse(saved.getexif())


if __name__ == '__main__':
    unittest.main()
