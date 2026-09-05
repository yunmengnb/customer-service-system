# 忆梦云团队开发 - admin-web UI 验证截图
import sys
from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    
    # ===== Login 页面 =====
    page = browser.new_page(viewport={"width": 1440, "height": 900})
    page.goto('http://localhost:5174/login', wait_until='networkidle')
    page.screenshot(path='/tmp/admin-login.png', full_page=True)
    print('login: OK')

    # ===== 登录并进入 Dashboard =====
    page.fill('input[type="text"]', 'admin')
    page.fill('input[type="password"]', 'admin123')
    page.click('.btn-primary')
    page.wait_for_load_state('networkidle')
    page.wait_for_timeout(600)
    page.screenshot(path='/tmp/admin-dashboard.png', full_page=True)
    print('dashboard: OK')

    # ===== 租户管理 =====
    page.goto('http://localhost:5174/tenants', wait_until='networkidle')
    page.wait_for_timeout(600)
    page.screenshot(path='/tmp/admin-tenants.png', full_page=True)
    print('tenants: OK')

    # ===== 手机视口 (390) =====
    page2 = browser.new_page(viewport={"width": 390, "height": 844})
    page2.goto('http://localhost:5174/tenants', wait_until='networkidle')
    page2.wait_for_timeout(600)
    page2.screenshot(path='/tmp/admin-tenants-mobile.png', full_page=True)
    print('tenants-mobile: OK')

    browser.close()
    print('DONE')
