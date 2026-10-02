# Astra Musica bandwidth update

Changes: existing embedded images are served separately with versioned browser caching; JSON responses use gzip; new still-image uploads are resized to a maximum dimension of 1200 pixels and encoded as WebP with transparency; GIF uploads are limited to 1 MB. Integrated Studio resolves relative image links against the competition site.

No database migration is needed. Existing stored images are preserved. The first image load still transfers the image; later visits can reuse browser cache. Cached image responses are public, matching the current public data API.

Validation: JavaScript syntax checks; media resolution and path validation; HTTP all-data/rankings/image checks; original state preservation; synthetic repeated-image payload reduced from 2,000,073 bytes to 205 bytes (image bytes are downloaded separately).

This update is not deployed. It does not guarantee usage fits Render Hobby, and does not fix all memory, authentication or database-failure handling issues. Those need further work. Existing images remain in server state and the database.

Apply server.js, media.js, public/app.js and Music_Management_Studio_Integrated.html together. package-lock.json records dependency versions. Keep current environment variables and Cluster0. Test the Admin, Judge and Public portals, images, scoring and Studio synchronization after deployment. Rolling back code is sufficient to undo this update; it does not rewrite database records.
