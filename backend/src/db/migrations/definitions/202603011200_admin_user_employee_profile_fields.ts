import type { MigrationDefinition } from '../types.js';
import { migrationAddColumnIfMissing, migrationCreateIndexIfNotExists } from '../helpers.js';

const EMPLOYEE_COLUMNS: Array<{ column: string; definition: string }> = [
  { column: 'salutation', definition: 'VARCHAR(80)' },
  { column: 'title', definition: 'VARCHAR(120)' },
  { column: 'building', definition: 'VARCHAR(120)' },
  { column: 'floor', definition: 'VARCHAR(80)' },
  { column: 'room', definition: 'VARCHAR(80)' },
  { column: 'position_slot', definition: 'TEXT' },
  { column: 'function_text', definition: 'TEXT' },
  { column: 'tasks_text', definition: 'TEXT' },
  { column: 'notes_text', definition: 'TEXT' },
  { column: 'phone_public', definition: 'VARCHAR(120)' },
  { column: 'phone_contact', definition: 'VARCHAR(120)' },
  { column: 'fax_public', definition: 'VARCHAR(120)' },
  { column: 'fax_contact', definition: 'VARCHAR(120)' },
  { column: 'mobile_public', definition: 'VARCHAR(120)' },
  { column: 'mobile_contact', definition: 'VARCHAR(120)' },
  { column: 'email_public', definition: 'VARCHAR(191)' },
  { column: 'email_contact', definition: 'VARCHAR(191)' },
  { column: 'website_public', definition: 'VARCHAR(255)' },
  { column: 'website_contact', definition: 'VARCHAR(255)' },
  { column: 'postal_street', definition: 'VARCHAR(255)' },
  { column: 'postal_house_number', definition: 'VARCHAR(40)' },
  { column: 'postal_postal_code', definition: 'VARCHAR(20)' },
  { column: 'postal_city', definition: 'VARCHAR(120)' },
  { column: 'postal_address_supplement', definition: 'VARCHAR(255)' },
  { column: 'postal_elevator_available', definition: 'BOOLEAN' },
  { column: 'postal_wheelchair_accessible', definition: 'BOOLEAN' },
  { column: 'postbox_postal_code', definition: 'VARCHAR(20)' },
  { column: 'postbox_city', definition: 'VARCHAR(120)' },
  { column: 'postbox_number', definition: 'VARCHAR(120)' },
  { column: 'postbox_elevator_available', definition: 'BOOLEAN' },
  { column: 'postbox_wheelchair_accessible', definition: 'BOOLEAN' },
  { column: 'visitor_street', definition: 'VARCHAR(255)' },
  { column: 'visitor_house_number', definition: 'VARCHAR(40)' },
  { column: 'visitor_postal_code', definition: 'VARCHAR(20)' },
  { column: 'visitor_city', definition: 'VARCHAR(120)' },
  { column: 'visitor_address_supplement', definition: 'VARCHAR(255)' },
  { column: 'visitor_elevator_available', definition: 'BOOLEAN' },
  { column: 'visitor_wheelchair_accessible', definition: 'BOOLEAN' },
  { column: 'delivery_street', definition: 'VARCHAR(255)' },
  { column: 'delivery_house_number', definition: 'VARCHAR(40)' },
  { column: 'delivery_postal_code', definition: 'VARCHAR(20)' },
  { column: 'delivery_city', definition: 'VARCHAR(120)' },
  { column: 'delivery_address_supplement', definition: 'VARCHAR(255)' },
  { column: 'delivery_elevator_available', definition: 'BOOLEAN' },
  { column: 'delivery_wheelchair_accessible', definition: 'BOOLEAN' },
  { column: 'org_unit_names_text', definition: 'TEXT' },
];

export const migration202603011200AdminUserEmployeeProfileFields: MigrationDefinition = {
  version: '202603011200',
  name: 'add_admin_user_employee_profile_fields',
  checksumSource: '202603011200:add_admin_user_employee_profile_fields:v1',
  up: async (db) => {
    for (const column of EMPLOYEE_COLUMNS) {
      await migrationAddColumnIfMissing({
        db,
        tableName: 'admin_users',
        columnName: column.column,
        columnDefinition: column.definition,
      });
    }

    await migrationCreateIndexIfNotExists({
      db,
      tableName: 'admin_users',
      indexName: 'idx_admin_users_email_contact',
      columns: ['email_contact'],
    });
  },
};

