import { convert } from '@scalar/postman-to-openapi';
import fs from 'fs';
import path from 'path';

const generateOAS = async () => {
  try {
    const postmanCollectionPath = './PostmanCollections/GooglePlayAPI.postman_collection.json';
    const outputPath = './openapi/swagger.json';

    console.log('Reading Postman collection...');
    const postmanCollection = JSON.parse(
      fs.readFileSync(postmanCollectionPath, 'utf-8')
    );

    console.log('Converting to OpenAPI...');
    const openapiSpec = await convert(postmanCollection);

    console.log('Writing OpenAPI spec...');
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, JSON.stringify(openapiSpec, null, 2));

    console.log('OpenAPI spec generated successfully!');
  } catch (err) {
    console.error('Error generating OpenAPI spec:', err);
    process.exit(1);
  }
};

generateOAS();
