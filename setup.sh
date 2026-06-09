# create d1 database
# npx wrangler@latest d1 create prod-d1-db-slice-upi-gateway

# init d1 database with schema
npx wrangler d1 execute prod-d1-db-slice-upi-gateway --remote --file=./schema.sql
npm run deploy
# to view logs

# npx wrangler d1 execute prod-d1-db-slice-upi-gateway --remote --command="SELECT * FROM Logs;"