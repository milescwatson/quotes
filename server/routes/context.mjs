export const operationInput = (request) => ({
  ...request.params,
  body: request.body === undefined ? {} : request.body,
  // Preserve Gateway's string values, including commas and repeated parameters.
  query: {
    ...(request.awsLambda?.event?.queryStringParameters ?? request.query),
  },
  identity: request.identity,
  requestId: request.id,
});
export const business = { config: { authentication: 'identity' } };
export const boundedBusiness = {
  config: { authentication: 'identity', boundedBody: true },
};
export async function respond(reply, result) {
  return reply.code(result.statusCode).send(result.body);
}
