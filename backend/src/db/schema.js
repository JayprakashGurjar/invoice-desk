import { db } from './knex.js';

const money = (t, name) => t.decimal(name, 18, 4).nullable();

export async function ensureSchema() {
  if (!(await db.schema.hasTable('suppliers'))) {
    await db.schema.createTable('suppliers', (t) => {
      t.increments('id').primary();
      t.string('name', 255).notNullable();
      t.string('address_line', 500);
      t.string('city', 120);
      t.string('postcode', 30);
      t.string('country', 80);
      t.string('phone', 60);
      t.string('email', 255);
      t.string('website', 255);
      t.string('vat_number', 60);
      t.string('company_number', 60);
      t.timestamp('created_at').defaultTo(db.fn.now());
      t.timestamp('updated_at').defaultTo(db.fn.now());
      t.index(['name']);
      t.index(['vat_number']);
    });
  }

  if (!(await db.schema.hasTable('customers'))) {
    await db.schema.createTable('customers', (t) => {
      t.increments('id').primary();
      t.string('name', 255).notNullable();
      t.string('address_line', 500);
      t.string('city', 120);
      t.string('postcode', 30);
      t.string('country', 80);
      t.string('phone', 60);
      t.string('email', 255);
      t.string('vat_number', 60);
      t.string('account_number', 60);
      t.timestamp('created_at').defaultTo(db.fn.now());
      t.timestamp('updated_at').defaultTo(db.fn.now());
      t.index(['name']);
    });
  }

  if (!(await db.schema.hasTable('invoices'))) {
    await db.schema.createTable('invoices', (t) => {
      t.increments('id').primary();
      // uploaded file
      t.string('file_name', 255).notNullable();
      t.string('original_name', 255).notNullable();
      t.string('mime_type', 100).notNullable();
      t.integer('file_size');
      // processing state
      t.string('status', 30).notNullable().defaultTo('queued'); // queued|processing|extracted|needs_review|approved|failed
      t.string('requested_provider', 30); // tool chosen at upload: auto or a provider id
      t.string('extraction_method', 30);  // provider id that actually read the document
      t.text('error');
      t.decimal('confidence', 5, 4);
      t.text('review_notes'); // JSON array of validation issues
      t.text('raw_json');     // raw extraction output, kept for audit
      // relations
      t.integer('supplier_id').unsigned().references('id').inTable('suppliers').onDelete('SET NULL');
      t.integer('customer_id').unsigned().references('id').inTable('customers').onDelete('SET NULL');
      // header
      t.string('document_type', 30);
      t.string('invoice_number', 100);
      t.string('invoice_date', 10); // YYYY-MM-DD
      t.string('due_date', 10);
      t.string('po_number', 100);
      t.string('currency', 3);
      t.string('payment_terms', 255);
      t.string('payment_method', 100);
      money(t, 'subtotal');
      money(t, 'discount_total');
      money(t, 'tax_total');
      money(t, 'shipping');
      money(t, 'total_amount');
      money(t, 'amount_paid');
      money(t, 'amount_due');
      t.text('notes');
      t.timestamp('created_at').defaultTo(db.fn.now());
      t.timestamp('updated_at').defaultTo(db.fn.now());
      t.index(['status']);
      t.index(['supplier_id']);
      t.index(['invoice_number']);
    });
  }

  // Upgrades for databases created by earlier versions.
  if (!(await db.schema.hasColumn('invoices', 'requested_provider'))) {
    await db.schema.alterTable('invoices', (t) => { t.string('requested_provider', 30); });
  }

  if (!(await db.schema.hasTable('invoice_taxes'))) {
    await db.schema.createTable('invoice_taxes', (t) => {
      t.increments('id').primary();
      t.integer('invoice_id').unsigned().notNullable()
        .references('id').inTable('invoices').onDelete('CASCADE');
      t.string('tax_name', 100);
      t.decimal('rate', 9, 4);
      money(t, 'taxable_amount');
      money(t, 'tax_amount');
      t.index(['invoice_id']);
    });
  }

  if (!(await db.schema.hasTable('line_items'))) {
    await db.schema.createTable('line_items', (t) => {
      t.increments('id').primary();
      t.integer('invoice_id').unsigned().notNullable()
        .references('id').inTable('invoices').onDelete('CASCADE');
      t.integer('line_no');
      t.string('description', 1000);
      t.string('product_code', 100);
      t.decimal('quantity', 18, 4);
      t.string('unit', 50);
      money(t, 'unit_price');
      money(t, 'discount');
      t.decimal('tax_rate', 9, 4);
      money(t, 'tax_amount');
      money(t, 'net_amount');
      money(t, 'total_amount');
      t.index(['invoice_id']);
    });
  }

  // Version 2: merged files are split into one document per invoice.
  const splitColumns = {
    parent_invoice_id: (t) => t.integer('parent_invoice_id').nullable(),
    page_from: (t) => t.integer('page_from').nullable(),
    page_to: (t) => t.integer('page_to').nullable(),
    page_count: (t) => t.integer('page_count').nullable(),
    split_requested: (t) => t.boolean('split_requested').notNullable().defaultTo(true),
  };
  for (const [name, add] of Object.entries(splitColumns)) {
    if (!(await db.schema.hasColumn('invoices', name))) await db.schema.alterTable('invoices', add);
  }
}
