# ხუმროHub — Neon + Cloudinary Upgrade

ეს ვერსია აღარ იყენებს SQLite-ს და local uploads-ს.

## რას იყენებს

- Render — Node.js app hosting
- Neon — PostgreSQL database
- Cloudinary — profile/joke image storage

ამით redeploy/restart-ზე აღარ დაიკარგება:
- users
- jokes
- comments
- reports
- reactions
- profile photos
- joke images

## Environment Variables Render-ში

აუცილებლად დაამატე:

```env
DATABASE_URL=Neon connection string
CLOUDINARY_CLOUD_NAME=your_cloud_name
CLOUDINARY_API_KEY=your_api_key
CLOUDINARY_API_SECRET=your_api_secret
ADMIN_USERNAME=admin
ADMIN_PASSWORD=yourStrongPassword
NODE_ENV=production
```

## Render commands

Build Command:
```bash
npm install
```

Start Command:
```bash
npm start
```

## Admin

Admin ავტომატურად იქმნება პირველ გაშვებაზე Environment Variables-დან:

```text
ADMIN_USERNAME
ADMIN_PASSWORD
```

## მნიშვნელოვანი

ძველი SQLite database ავტომატურად არ გადმოვა Neon-ში. ეს არის ახალი სუფთა ვერსია.
