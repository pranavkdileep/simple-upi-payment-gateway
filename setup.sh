# create d1 database
# npx wrangler@latest d1 create prod-d1-db-slice-upi-gateway

# init d1 database with schema
npx wrangler d1 execute prod-d1-db-slice-upi-gateway --remote --file=./schema.sql
# create kv namespace
npx wrangler kv namespace create sclice-upi-gateway-namespace
npm run deploy
# to view logs

# npx wrangler d1 execute prod-d1-db-slice-upi-gateway --remote --command="SELECT * FROM Logs;"