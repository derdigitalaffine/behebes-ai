/**
 * © Dominik Tröster, Verbandsgemeinde Otterbach Otterberg
 * Apache License 2.0
 * 
 * Admin User Management
 */

import bcryptjs from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import type { AppDatabase } from '../database.js';
import { AdminUser } from '../models/types.js';
import { normalizeRole } from '../utils/roles.js';

export interface CreateAdminInput {
  username: string;
  password: string;
  role?: 'ADMIN' | 'SACHBEARBEITER' | 'SUPERADMIN' | 'MODERATOR' | 'VIEWER';
  email?: string;
  firstName?: string;
  lastName?: string;
  jobTitle?: string;
  workPhone?: string;
}

function mapAdminRow(row: any): AdminUser | null {
  if (!row) return null;
  return {
    id: row.id,
    username: row.username,
    passwordHash: row.password_hash ?? row.passwordHash,
    role: row.role,
    email: row.email || undefined,
    firstName: row.first_name || row.firstName || undefined,
    lastName: row.last_name || row.lastName || undefined,
    jobTitle: row.job_title || row.jobTitle || undefined,
    workPhone: row.work_phone || row.workPhone || undefined,
    active: !!row.active,
    createdAt: row.created_at || row.createdAt,
    updatedAt: row.updated_at || row.updatedAt,
  };
}

export async function createAdminUser(db: AppDatabase, input: CreateAdminInput): Promise<AdminUser> {
  const id = uuidv4();
  const passwordHash = await bcryptjs.hash(input.password, 10);
  const role = normalizeRole(input.role) || 'SACHBEARBEITER';
  
  await db.run(
    `INSERT INTO admin_users (id, username, password_hash, role, active, email, first_name, last_name, job_title, work_phone)
     VALUES (?, ?, ?, ?, TRUE, ?, ?, ?, ?, ?)`,
    [
      id,
      input.username,
      passwordHash,
      role,
      input.email || null,
      input.firstName || null,
      input.lastName || null,
      input.jobTitle || null,
      input.workPhone || null,
    ]
  );
  
  return {
    id,
    username: input.username,
    passwordHash,
    role,
    email: input.email || undefined,
    firstName: input.firstName || undefined,
    lastName: input.lastName || undefined,
    jobTitle: input.jobTitle || undefined,
    workPhone: input.workPhone || undefined,
    active: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

export async function findAdminByUsername(db: AppDatabase, username: string): Promise<AdminUser | null> {
  const user = await db.get(
    `SELECT * FROM admin_users WHERE username = ?`,
    [username]
  );
  return mapAdminRow(user);
}

export async function findAdminById(db: AppDatabase, id: string): Promise<AdminUser | null> {
  const user = await db.get(
    `SELECT * FROM admin_users WHERE id = ?`,
    [id]
  );
  return mapAdminRow(user);
}

export async function findAdminByIdentifier(db: AppDatabase, identifier: string): Promise<AdminUser | null> {
  const user = await db.get(
    `SELECT * FROM admin_users WHERE username = ? OR email = ?`,
    [identifier, identifier]
  );
  return mapAdminRow(user);
}

export async function updateAdminPassword(db: AppDatabase, userId: string, newPassword: string): Promise<void> {
  const passwordHash = await bcryptjs.hash(newPassword, 10);
  await db.run(
    `UPDATE admin_users SET password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    [passwordHash, userId]
  );
}

export async function createDefaultAdminUser(db: AppDatabase, username: string, password: string): Promise<void> {
  try {
    const existing = await findAdminByUsername(db, username);
    
    if (existing) {
      // Update existing default admin
      await updateAdminPassword(db, existing.id, password);
      if (normalizeRole(existing.role) !== 'ADMIN') {
        await db.run(
          `UPDATE admin_users SET role = 'ADMIN', updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
          [existing.id]
        );
      }
      console.log(`✓ Default-Admin aktualisiert: ${username}`);
    } else {
      // Create new default admin
      await createAdminUser(db, {
        username,
        password,
        role: 'ADMIN',
      });
      console.log(`✓ Default-Admin erstellt: ${username}`);
    }
  } catch (error) {
    console.error('Fehler beim Erstellen des Standard-Admins:', error);
    throw error;
  }
}
