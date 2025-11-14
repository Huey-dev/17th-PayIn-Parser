const { createHandler } = require('@app-core/server');
const parseInstruction = require('../../services/payment-processor/parse-instruction');

module.exports = createHandler({
  path: '/payment-instructions',
  method: 'post',
  middlewares: [],
  async handler(rc, helpers) {
    const payload = rc.body;
    const result = await parseInstruction(payload);
    let httpStatus;
    if (result.status === 'successful' || result.status === 'pending') {
      httpStatus = helpers.http_statuses.HTTP_200_OK;
    } else {
      httpStatus = helpers.http_statuses.HTTP_400_BAD_REQUEST;
    }

    return {
      status: httpStatus,
      data: result,
    };
  },
});
