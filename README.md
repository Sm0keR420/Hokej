# Hokej

Jednoduché simulační jádro pro hokej 5+1. Každý tým má centra, dvě křídla,
dva obránce a brankáře. Hráče ovládají samostatní agenti, kteří mohou dostat
rozhodnutí podle role přepsané vlastní strategií.

## Spuštění

```sh
npm test
npm run simulate
npm start
```

Grafické rozhraní pak otevři na `http://localhost:5173`.

## Použití

```js
import { createGame, stepGame, simulateGame } from "./src/hockey.js";

const game = createGame({ seed: 42, periodLength: 1200 });
stepGame(game); // Jeden herní krok; výchozí jsou pravidloví agenti.
// Nebo: simulateGame(game) odehraje zbytek utkání.
```

Vlastní agenti se předávají do `stepGame(game, { agents })`. Agent může být
registrovaný podle ID hráče nebo role; dostane neměnný snapshot stavu a hráče a
vrátí akci. Dostupné akce podle role jsou exportované v `ROLE_ACTIONS`.
Aktuálně simulace zahrnuje pohyb, přihrávky a jejich zachycení, střely, zákroky,
napadání, zisky puku, vhazování na středové čáře po gólu a čas utkání.
`game.events` obsahuje události posledního kroku.

Pro živé grafické rozhraní spusť `npm start`. Zobrazuje kluziště, hráče a puk,
průběžné skóre, čas, události a ovládání rychlosti simulace.
