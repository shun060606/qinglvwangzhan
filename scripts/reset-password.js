'use strict';

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');

const password = String(process.argv[2] || '').trim();
const dbPath = path.join(__dirname, '..', 'data', 'anyu.db');

if (!fs.existsSync(dbPath)) {
  console.error('没有找到 data/anyu.db，请先启动一次网站再重置密码。');
  process.exit(1);
}
if (password.length < 6 || password.length > 64) {
  console.error('新密码长度需要在 6 到 64 位之间。');
  process.exit(1);
}

const salt = crypto.randomBytes(16).toString('hex');
const hash = crypto.scryptSync(password, salt, 64).toString('hex');
const stored = `scrypt$${salt}$${hash}`;
const db = new DatabaseSync(dbPath);
try {
  db.prepare(`
    INSERT INTO settings (key, value) VALUES ('adminPasswordHash', ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(stored);
  db.prepare(`
    INSERT INTO settings (key, value) VALUES ('passwordIsDefault', ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(password === 'anyu520' ? '1' : '0');
  db.close();
  console.log('');
  console.log('  后台密码已重置。');
  console.log('  请关闭正在运行的网站窗口，重新启动后使用新密码登录。');
  console.log('');
} catch (error) {
  try { db.close(); } catch { /* ignore */ }
  console.error('重置失败：', error.message);
  process.exit(1);
}
