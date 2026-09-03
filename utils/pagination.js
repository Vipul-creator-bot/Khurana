// List-endpoint pagination matching Zoho Inventory's convention: `page` and
// `per_page` query params in, a `page_context` object out alongside the
// resource array (https://www.zoho.com/inventory/api/v1/introduction/#overview
// documents that list endpoints are paginated).

const MAX_PER_PAGE = 200;
const DEFAULT_PER_PAGE = 25;

function paginate(items, req, { reportName } = {}) {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const perPage = Math.min(MAX_PER_PAGE, Math.max(1, parseInt(req.query.per_page, 10) || DEFAULT_PER_PAGE));
  const start = (page - 1) * perPage;
  const pageItems = items.slice(start, start + perPage);

  return {
    items: pageItems,
    page_context: {
      page,
      per_page: perPage,
      has_more_page: start + perPage < items.length,
      report_name: reportName,
    },
  };
}

module.exports = { paginate };
