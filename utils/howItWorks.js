const fs = require('fs');
const path = require('path');
const { howItWorksDb } = require('../db');

const SEED_PATH = path.join(__dirname, '..', 'data', 'how-it-works.json');

// One-time import, same pattern as ensureCatalogSeeded in utils/catalog.js.
async function ensureHowItWorksSeeded() {
  const count = await howItWorksDb.countAsync({});
  if (count === 0 && fs.existsSync(SEED_PATH)) {
    const seedSteps = JSON.parse(fs.readFileSync(SEED_PATH, 'utf-8'));
    for (const step of seedSteps) {
      // eslint-disable-next-line no-await-in-loop
      await howItWorksDb.insertAsync(step);
    }
    console.log(`How It Works: seeded ${seedSteps.length} steps from how-it-works.json`);
  }
}

function stripMongoId(doc) {
  const { _id, ...rest } = doc;
  return rest;
}

async function nextId() {
  const all = await howItWorksDb.findAsync({});
  const max = all.reduce((m, doc) => Math.max(m, Number(doc.id) || 0), 0);
  return max + 1;
}

async function getAllSteps() {
  const docs = await howItWorksDb.findAsync({});
  return docs.map(stripMongoId).sort((a, b) => a.order - b.order);
}

async function getStepById(id) {
  const doc = await howItWorksDb.findOneAsync({ id: Number(id) });
  return doc ? stripMongoId(doc) : null;
}

async function createStep(data) {
  const id = await nextId();
  const all = await howItWorksDb.findAsync({});
  const maxOrder = all.reduce((m, d) => Math.max(m, Number(d.order) || 0), 0);

  const step = {
    id,
    title: data.title,
    points: Array.isArray(data.points) ? data.points : [],
    image: data.image || '',
    order: data.order !== undefined && data.order !== '' ? Number(data.order) : maxOrder + 1,
  };
  await howItWorksDb.insertAsync(step);
  return step;
}

async function updateStep(id, data) {
  const existing = await howItWorksDb.findOneAsync({ id: Number(id) });
  if (!existing) return null;

  const updates = {};
  if (data.title !== undefined) updates.title = data.title;
  if (data.points !== undefined) updates.points = data.points;
  if (data.order !== undefined && data.order !== '') updates.order = Number(data.order);
  if (data.image) updates.image = data.image;

  await howItWorksDb.updateAsync({ id: Number(id) }, { $set: updates });
  return getStepById(id);
}

async function deleteStep(id) {
  const removed = await howItWorksDb.removeAsync({ id: Number(id) }, {});
  return removed > 0;
}

module.exports = {
  ensureHowItWorksSeeded,
  getAllSteps,
  getStepById,
  createStep,
  updateStep,
  deleteStep,
};
