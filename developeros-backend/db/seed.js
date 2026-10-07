// ══════════════════════════════════════════════════════════════
// db/seed.js — Canonical V1 Fixture Database Seeder
// Seeds PostgreSQL with canonical v1 dataset idempotently
// ══════════════════════════════════════════════════════════════

const path = require('path');
const fs = require('fs');
const { runMigrations, withMigrationClient } = require('./migrate');

const FIXTURE_PATH = path.join(__dirname, '..', 'tests', 'fixtures', 'canonical-v1-fixture.json');

// The seeder TRUNCATEs business tables, which only the migration/owner role
// may do; the runtime role holds no TRUNCATE privilege.
function ownerTransaction(fn) {
  return withMigrationClient(async (client) => {
    await client.query('BEGIN');
    try {
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    }
  });
}

function assertSafeToTruncate() {
  const url = process.env.MIGRATION_DATABASE_URL;
  if (!url) throw new Error('[SEED] MIGRATION_DATABASE_URL is not set.');
  const dbName = decodeURIComponent(new URL(url).pathname.slice(1));
  const isTestDb = /_test$/.test(dbName);
  const forced = process.env.ALLOW_DESTRUCTIVE_SEED === 'true';
  if (!isTestDb && !forced) {
    throw new Error(
      `[SEED] REFUSING to TRUNCATE database "${dbName}": it is not a *_test database. ` +
      'The seeder wipes all data. Set ALLOW_DESTRUCTIVE_SEED=true only if you really intend this.'
    );
  }
}

async function seedDatabase(fixtureData = null) {
  assertSafeToTruncate();
  await runMigrations();
  const data = fixtureData || JSON.parse(fs.readFileSync(FIXTURE_PATH, 'utf8'));

  console.log('[SEED] Seeding canonical v1 data into PostgreSQL...');

  return ownerTransaction(async (client) => {
    // Truncate existing tables cleanly with CASCADE
    await client.query(`
      TRUNCATE TABLE 
        task_dependencies,
        permit_corrections,
        capital_sources,
        messages,
        documents,
        tasks,
        contracts,
        permits,
        capital_stacks,
        channels,
        projects,
        partners,
        team_members,
        users,
        organizations
      CASCADE
    `);

    // 1. Organizations
    for (const org of data.organizations) {
      await client.query(`
        INSERT INTO organizations (id, name, type, projects_count, users_count, plan)
        VALUES ($1, $2, $3, $4, $5, $6)
      `, [org.id, org.name, org.type, org.projects || 0, org.users || 0, org.plan]);
    }

    // 2. Users
    for (const u of data.users) {
      await client.query(`
        INSERT INTO users (id, org_id, name, email, password_hash, role, active)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
      `, [u.id, u.orgId || 'org1', u.name, u.email.toLowerCase(), u.passwordHash, u.role, u.active !== false]);
    }

    // Security bootstrap for the canonical V1 identities. These mappings are
    // deliberately explicit: legacy users.role is compatibility data and must
    // never be promoted into membership authority by a generic conversion.
    const canonicalMemberships = [
      {
        id: 'membership-canonical-admin-org1',
        email: 'admin@developeros.com',
        organizationId: 'org1',
        roleId: 'org-admin',
      },
      {
        id: 'membership-canonical-maria-org1',
        email: 'maria@kgdevelopment.com',
        organizationId: 'org1',
        roleId: 'developer',
      },
    ];

    for (const membership of canonicalMemberships) {
      const result = await client.query(`
        INSERT INTO memberships (id, user_id, organization_id, role_id, status)
        SELECT $1, u.id, o.id, r.id, 'ACTIVE'
        FROM users u
        JOIN organizations o ON o.id = $3
        JOIN roles r ON r.id = $4
        WHERE LOWER(u.email) = LOWER($2)
        ON CONFLICT (user_id, organization_id) DO UPDATE
          SET role_id = EXCLUDED.role_id,
              status = 'ACTIVE',
              updated_at = NOW()
        RETURNING id
      `, [membership.id, membership.email, membership.organizationId, membership.roleId]);

      if (result.rowCount !== 1) {
        throw new Error(
          `[SEED] Canonical membership bootstrap failed for ${membership.email} ` +
          `in ${membership.organizationId} with role ${membership.roleId}.`
        );
      }
    }

    // 3. Partners
    for (const p of data.partners) {
      await client.query(`
        INSERT INTO partners (id, org_id, name, role, initials)
        VALUES ($1, $2, $3, $4, $5)
      `, [p.id, 'org1', p.name, p.role, p.initials]);
    }

    // 4. Projects
    for (const p of data.projects) {
      await client.query(`
        INSERT INTO projects (id, organization_id, name, type, units, affordable_units, budget, progress, phase, phase_label, status, alert_count, city, program, created_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
      `, [
        p.id,
        p.orgId || 'org1',
        p.name,
        p.type,
        p.units,
        p.affordableUnits || 0,
        p.budget,
        p.progress || 0,
        p.phase || 1,
        p.phaseLabel || '',
        p.status || 'on-track',
        p.alertCount || 0,
        p.city || '',
        p.program || '',
        p.createdAt || new Date().toISOString(),
      ]);
    }

    // 5. Contracts
    for (const c of data.contracts) {
      await client.query(`
        INSERT INTO contracts (id, project_id, partner_id, type, status, value, executed_date, linked_task_count)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      `, [
        c.id,
        c.projectId,
        c.partnerId,
        c.type,
        c.status,
        c.value,
        c.executedDate,
        c.linkedTaskCount || 0,
      ]);
    }

    // 6. Tasks
    for (const t of data.tasks) {
      await client.query(`
        INSERT INTO tasks (id, project_id, title, discipline, partner_id, contract_id, status, due_date, note)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      `, [
        t.id,
        t.projectId,
        t.title,
        t.discipline,
        t.partnerId,
        t.contractId,
        t.status,
        t.dueDate,
        t.note || '',
      ]);

      // Dependencies
      if (Array.isArray(t.deps)) {
        for (const depId of t.deps) {
          await client.query(`
            INSERT INTO task_dependencies (task_id, depends_on_task_id)
            VALUES ($1, $2)
            ON CONFLICT DO NOTHING
          `, [t.id, depId]);
        }
      }
    }

    // 7. Permits & Permit Corrections
    for (const pm of data.permits) {
      await client.query(`
        INSERT INTO permits (id, project_id, name, jurisdiction, type, status, submitted_date, approved_date)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      `, [
        pm.id,
        pm.projectId,
        pm.name,
        pm.jurisdiction,
        pm.type,
        pm.status,
        pm.submittedDate,
        pm.approvedDate,
      ]);

      if (Array.isArray(pm.corrections)) {
        for (const cor of pm.corrections) {
          await client.query(`
            INSERT INTO permit_corrections (id, permit_id, text, status)
            VALUES ($1, $2, $3, $4)
          `, [cor.id, pm.id, cor.text, cor.status]);
        }
      }
    }

    // 8. Capital Stacks & Capital Sources
    for (const cs of data.capitalStacks) {
      await client.query(`
        INSERT INTO capital_stacks (id, project_id, total_cost)
        VALUES ($1, $2, $3)
      `, [cs.id, cs.projectId, cs.totalCost]);

      if (Array.isArray(cs.sources)) {
        for (const src of cs.sources) {
          await client.query(`
            INSERT INTO capital_sources (id, capital_stack_id, name, type, amount, pct, status, color, deadline, alert)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
          `, [
            src.id,
            cs.id,
            src.name,
            src.type,
            src.amount,
            src.pct,
            src.status,
            src.color,
            src.deadline || null,
            src.alert || null,
          ]);
        }
      }
    }

    // 9. Channels & Messages
    for (const ch of data.channels) {
      await client.query(`
        INSERT INTO channels (id, project_id, name, description, unread)
        VALUES ($1, $2, $3, $4, $5)
      `, [ch.id, ch.projectId, ch.name, ch.desc || '', ch.unread || 0]);
    }

    for (const m of data.messages) {
      await client.query(`
        INSERT INTO messages (id, channel_id, sender_name, sender_initials, sender_color, role, text, timestamp)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      `, [
        m.id,
        m.channelId,
        m.senderName,
        m.senderInitials || '',
        m.senderColor || '#1A2332',
        m.role || '',
        m.text,
        m.timestamp || new Date().toISOString(),
      ]);
    }

    // 10. Documents
    for (const d of data.documents) {
      await client.query(`
        INSERT INTO documents (id, project_id, name, category, uploaded_by, date, type, icon)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      `, [d.id, d.projectId, d.name, d.category, d.uploadedBy, d.date, d.type, d.icon]);
    }

    // 11. Team Members
    for (const tm of data.teamMembers) {
      await client.query(`
        INSERT INTO team_members (id, organization_id, name, role, projects, status, last_active)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
      `, [tm.id, 'org1', tm.name, tm.role, tm.projects, tm.status, tm.lastActive || new Date().toISOString()]);
    }

    console.log('[SEED] Canonical v1 data seeded successfully into PostgreSQL.');
    return { success: true };
  });
}

if (require.main === module) {
  seedDatabase()
    .then(() => process.exit(0))
    .catch(err => {
      console.error('[SEED] Seeding failed:', err);
      process.exit(1);
    });
}

module.exports = { seedDatabase };
