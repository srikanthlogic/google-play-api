# Google Play API
![GitHub tag (latest SemVer pre-release)](https://img.shields.io/github/v/tag/srikanthlogic/google-play-api?include_prereleases&label=version) [![Newman Run](https://github.com/srikanthlogic/google-play-api/actions/workflows/newman.yml/badge.svg)](https://github.com/srikanthlogic/google-play-api/actions/workflows/newman.yml) [![API Documentation](https://img.shields.io/badge/api-documentation-brightgreen)](https://gplayapi.cashlessconsumer.in/) [![Deploy](https://button.deta.dev/1/svg)](https://deta.space/discovery/@cashlessconsumer/googleplayapi)

Google Play API is a REST API wrapper originally built on top of [google-play-scraper](https://github.com/facundoolano/google-play-scraper) by [Facundoolano](https://github.com/facundoolano) to fetch metadata from [Google Play](https://en.wikipedia.org/wiki/Google_Play). This repository extends it and adds additional endpoints.

## API Server
The API Server is built on ExpressJS and self contains API documentation.

To run locally:
* Clone the repository and run
* `npm install`
* `npm run generateoas` - Generates the OpenAPI specification
* `npm start`

### Deployments
The API Server can be installed as a [Deta app](https://deta.space/discovery/@cashlessconsumer/googleplayapi).

### Roadmap
* [ ] Expose more endpoints helping towards archiving.
* [ ] Support Global options
* [X] Deta Support. [#34](https://github.com/srikanthlogic/google-play-api/issues/34)
* [X] Support Lists [#36](https://github.com/srikanthlogic/google-play-api/issues/36)
* [X] Support privacy friendly reviews extraction  [#40](https://github.com/srikanthlogic/google-play-api/issues/40)

## Disclaimer
* Google Play data is bound by terms of Google. We believe - the data in the Play Store ecosystem, belong to people (Users) and hence must be available to them in form that will allow them to make best use of.
