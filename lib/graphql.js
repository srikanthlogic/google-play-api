import express from 'express';
import { graphqlHTTP } from 'express-graphql';
import { createGraphQLSchema } from 'openapi-to-graphql';
import path from 'path';
import fs from 'fs';

// Load the OpenAPI specification
const openApiSpec = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../openapi/swagger.json'), 'utf8'));

// Generate the GraphQL schema from the OpenAPI specification
const { schema } = createGraphQLSchema(openApiSpec);

// Create a new GraphQL server
const graphqlServer = express();
graphqlServer.use('/graphql', graphqlHTTP({
  schema: schema,
  graphiql: true,
}));

export default graphqlServer;
