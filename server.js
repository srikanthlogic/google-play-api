'use strict';

import Express from 'express';
import router from './lib/index.js';
import swaggerDocument from './openapi/swagger.json' assert { type: "json" };
import swaggerUi from 'swagger-ui-express';
import morgan from 'morgan';

const app = Express();
const port = process.env.PORT || 3000;

var options = {
  customCss: '.swagger-ui .topbar { display: none }'
};

app.use('/openapi.json', Express.static('openapi/swagger.json'));

app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerDocument, options));
app.use('/api/', router);

if (process.env.LOGGING || false) {
  console.log('Logging is enabled');
  app.use(morgan('combined'));
}

app.get('/', function (req, res) {
  res.redirect('/api-docs');
});

app.use('/openapi.json', Express.static('openapi/swagger.json'));
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerDocument, options));
app.use('/api/', router);

app.listen(port, function () {
  console.log('Server started on port', port);
});