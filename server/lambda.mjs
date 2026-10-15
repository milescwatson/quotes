import awsLambdaFastify from '@fastify/aws-lambda';
export function createLambdaHandler(app) {
  const proxy = awsLambdaFastify(app, {
    decorateRequest: true,
    serializeLambdaArguments: false,
    parseCommaSeparatedQueryParams: false,
    binaryMimeTypes: ['application/pdf'],
  });
  const ready = app.ready();
  return async (event, context) => {
    await ready;
    return proxy(event, context);
  };
}
