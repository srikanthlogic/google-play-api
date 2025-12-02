import newman from 'newman';
import fs from 'fs';
import path from 'path';

const collectionsPath = './PostmanCollections/';
const collectionData = JSON.parse(fs.readFileSync(path.resolve(collectionsPath + 'GooglePlayAPI.postman_collection.json'), 'utf8'));
const utCollectionData = JSON.parse(fs.readFileSync(path.resolve(collectionsPath + 'GPlayAPIUnitTests.postman_collection.json'), 'utf8'));
const environmentData = JSON.parse(fs.readFileSync(path.resolve(collectionsPath + 'postman_environment.json'), 'utf8'));

const runTests = async () => {
  try {
    newman.run({
      collection: collectionData,
      environment: environmentData,
      reporters: ['cli', 'htmlextra']
    });

    newman.run({
      collection: utCollectionData,
      environment: environmentData,
      reporters: ['cli', 'htmlextra']
    });

    console.log('API tests completed successfully!');
  } catch (err) {
    console.error('Newman encountered an error:', err);
    process.exit(1);
  }
};

runTests();
