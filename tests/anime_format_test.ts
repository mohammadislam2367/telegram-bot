import { assert, assertEquals } from "@std/assert";
import {
  type AnimeInfo,
  animeListButtons,
  cleanAnimeQuery,
  formatAnimeCard,
  formatAnimeList,
} from "../supabase/functions/_shared/anime_data.ts";

const anime: AnimeInfo = {
  malId: 16498,
  title: "Shingeki no Kyojin",
  titleEnglish: "Attack on Titan",
  titleJapanese: "進撃の巨人",
  type: "TV",
  episodes: 25,
  status: "Finished Airing",
  aired: "Apr 7, 2013 to Sep 29, 2013",
  duration: "24 min per ep",
  rating: "R - 17+",
  score: 8.55,
  rank: 110,
  popularity: 3,
  members: 3_000_000,
  synopsis: "Humans fight <giant> titans behind walls.",
  season: "spring",
  year: 2013,
  studios: ["Wit Studio"],
  genres: ["Action", "Drama"],
  imageUrl: "https://cdn.example/cover.jpg",
  url: "https://myanimelist.net/anime/16498",
  trailerUrl: "https://youtube.com/watch?v=x",
};

Deno.test("formatAnimeCard includes title, score, studio and escapes HTML", () => {
  const card = formatAnimeCard(anime);
  assert(card.includes("Shingeki no Kyojin"));
  assert(card.includes("Attack on Titan"));
  assert(card.includes("Wit Studio"));
  assert(card.includes("۸٫۵۵") || card.includes("۸.۵۵"));
  assert(card.includes("&lt;giant&gt;"));
  assert(card.includes("myanimelist.net/anime/16498"));
});

Deno.test("formatAnimeList numbers items and shows metadata", () => {
  const list = formatAnimeList([anime, { ...anime, malId: 2, title: "Second", episodes: null }]);
  assert(list.includes("۱."));
  assert(list.includes("۲."));
  assert(list.includes("Second"));
  assert(list.includes("۲۵ قسمت") || list.includes("25 قسمت"));
});

Deno.test("animeListButtons produce safe short callbacks", () => {
  const rows = animeListButtons([
    anime,
    { ...anime, malId: 5 },
    { ...anime, malId: 6 },
    { ...anime, malId: 7 },
  ]);
  assertEquals(rows.length, 2);
  assertEquals(rows[0][0].callback_data, "u:an:16498");
  assertEquals(rows[1][0].callback_data, "u:an:7");
});

Deno.test("cleanAnimeQuery removes commands and question words", () => {
  assertEquals(cleanAnimeQuery("/anime اتک آن تایتان چیه"), "اتک آن تایتان");
  assertEquals(cleanAnimeQuery("اطلاعات انیمه Frieren"), "Frieren");
  assertEquals(cleanAnimeQuery("   "), "");
  assertEquals(cleanAnimeQuery("x".repeat(200)).length, 100);
});
