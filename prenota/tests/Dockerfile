# Official Playwright image, the same as tenutaroveglia-testing. Keep the tag in step with
# @playwright/test in package.json.
FROM mcr.microsoft.com/playwright:v1.64.1-noble

WORKDIR /prenota/tests
COPY package.json package-lock.json ./
RUN npm ci

COPY . .
ENV CI=1 TZ=Europe/Rome
ENTRYPOINT ["npx", "playwright", "test"]
