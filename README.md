# ხუმროHub — Social Version FIXED

დამატებულია და გასწორებულია:

- პროფილის გვერდი
- მომხმარებლის ყველა ხუმრობა
- კომენტარები ხუმრობებზე
- report button
- admin panel ცალკე გვერდად
- profile photo upload
- joke/meme image upload
- edit/delete მხოლოდ ავტორს ან admin-ს
- username validation
- upload error handler
- comments აღარ იკეცება კომენტარის დამატების შემდეგ
- password hashing bcrypt-ით
- reaction spam fix: ერთ user-ს ერთ joke-ზე მხოლოდ ერთი reaction შეუძლია
- admin მონაცემების დაყენება `.env`-ით

## Admin account

Default:

```text
username: admin
password: admin1234
```

შეგიძლია შეცვალო `.env` ფაილით:

```env
ADMIN_USERNAME=admin
ADMIN_PASSWORD=yourStrongPassword
PORT=3000
```

## User test account

```text
username: gita
password: 1234
```

## გაშვება

```bash
npm install
npm start
```

შემდეგ გახსენი:

```text
http://localhost:3000
```

## მნიშვნელოვანი

თუ ძველი `jokes.db` გაქვს იმავე folder-ში, წაშალე და თავიდან გაუშვი, რომ ახალი database სუფთად შეიქმნას.

ფოტოების ლიმიტი არის 2MB და დაშვებულია:

```text
jpg, png, webp, gif
```


## Reaction სისტემა

მომხმარებელს ერთ ხუმრობაზე მხოლოდ ერთი reaction შეუძლია. თუ სხვა reaction-ს დააჭერს, ძველი მოეხსნება და ახალი დაემატება.
