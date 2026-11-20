# Maryland Call Sheet

A shared call list of Maryland restaurants with no website listed. Your team signs in with one password, works through the list, and holds the circle on a card to mark a call done. Check-offs show up for everyone within a few seconds.

## Set up on Vercel (one time)

1. **Import the project.** In Vercel, choose **Add New → Project**, pick this GitHub repository, and click **Deploy**. Leave every build setting as it is. The first deploy will show a "storage isn't connected" message; that's expected until the next two steps are done.
2. **Add storage.** In the project, open the **Storage** tab, choose **Upstash for Redis** (free plan is enough), create it, and connect it to this project. Vercel adds the connection settings for you.
3. **Set the team password.** Open **Settings → Environment Variables** and add `TEAM_PASSWORD` with the password your team will use. Save.
4. **Redeploy.** Open **Deployments**, click the menu on the latest one, and choose **Redeploy**.

The first time anyone signs in, the 2,006 restaurants from the Claude version are loaded automatically.

## Everyday use

- **Sync now** asks OpenStreetMap for new restaurants, one region at a time. It also runs by itself once a day (early morning). **Pause sync** turns both off for everyone.
- **Import file** loads an Overpass Turbo export (raw OSM data or GeoJSON). Importing never removes restaurants or brings back ones already called.
- To lock everyone out, change `TEAM_PASSWORD` and redeploy. Everyone has to sign in again with the new password.

## Notes

- Vercel's free Hobby plan is for personal, non-commercial use. If this supports a business, Vercel expects the Pro plan.
- Restaurant data © OpenStreetMap contributors, under the Open Database License. Keep the credit on the page.
- The public OpenStreetMap servers ask heavy users to stay under about 10,000 requests a day. A full sync is 48 requests.

## Files

- `public/` is the page (`index.html`, `style.css`, `app.js`, and `fx.js` for the liquid background).
- `api/` holds the server routes: sign-in, the shared list, check-offs, sync, import and the daily update.
- `data/seed.js` is the restaurant list moved over from the Claude version.
