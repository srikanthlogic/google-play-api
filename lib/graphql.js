import { createGraphQLSchema } from 'openapi-to-graphql';
import { graphqlHTTP } from 'express-graphql';
import fs from 'fs';
import path from 'path';

const openApiSpec = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../openapi/swagger.json'), 'utf8'));
const graphqlSchema = createGraphQLSchema(openApiSpec);

export default function(app) {
  app.use('/graphql', graphqlHTTP({
    schema: graphqlSchema,
    graphiql: true
  }));
}
