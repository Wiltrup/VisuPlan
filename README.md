# VisuPlanner

Visuel og fælles ugeplan til Team 2.

## Funktioner
- Én dag ad gangen
- Fast farve for hver ugedag
- Fleksibel bemanding på morgen, aften og nat
- Aftensmad med billede og Pexels-billedsøgning
- Aktiviteter med tidspunkt og billede
- Fælles personalelogin
- Tilføjelse og fjernelse af medarbejdere og vikarer
- Fælles synkronisering gennem Supabase
- Ugeudgivelse og løbende ændringer
- Mobilvenlig PWA

## Pexels

Vercel-projektet skal have miljøvariablen `PEXELS_API_KEY`. Nøglen bruges kun i serverfunktionerne under `api/` og må ikke lægges i GitHub eller i `app.js`.

## Udgivelse på Vercel
Upload alle filer og mapper i denne mappe til roden af GitHub-repository'et. Framework preset kan stå som `Other`, og der kræves ingen build command. Vercel udgiver automatisk efter commit.
