const path = require('path');
const Datastore = require('@seald-io/nedb');

// File-based, persistent, embedded database (no separate DB server required).
// Data lives in backend/data/*.db as newline-delimited JSON — inspect or back it
// up like any other file. Swap this module out for Postgres/MongoDB later
// without touching route logic, since routes only talk to the methods below.

const usersDb = new Datastore({
  filename: path.join(__dirname, '..', 'data', 'users.db'),
  autoload: true,
});
const ordersDb = new Datastore({
  filename: path.join(__dirname, '..', 'data', 'orders.db'),
  autoload: true,
});

usersDb.ensureIndexAsync({ fieldName: 'email', unique: true }).catch((err) => {
  console.error('Failed to create users email index:', err);
});

module.exports = { usersDb, ordersDb };
