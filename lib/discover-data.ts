// Browse page constants: genres (Cinemeta + TMDB) and countries (TMDB discover).

export interface Genre {
    id: string;
    /** Label exactly matching Cinemeta's genre options (case-sensitive) */
    label: string;
    hue: number;
    /** TMDB movie genre ID for /discover/movie?with_genres= */
    tmdbMovie: number;
    /** TMDB TV genre ID for /discover/tv?with_genres= */
    tmdbTV: number;
}

export interface Country {
    /** ISO 3166-1 alpha-2 code (uppercase for TMDB) */
    id: string;
    label: string;
    flag: string;
    hue: number;
}

// TMDB genre IDs: https://developer.themoviedb.org/reference/genre-movie-list
export const GENRES: Genre[] = [
    { id: "action",      label: "Action",       hue: 15,  tmdbMovie: 28,    tmdbTV: 10759 },
    { id: "adventure",   label: "Adventure",    hue: 50,  tmdbMovie: 12,    tmdbTV: 10759 },
    { id: "animation",   label: "Animation",    hue: 160, tmdbMovie: 16,    tmdbTV: 16 },
    { id: "comedy",      label: "Comedy",       hue: 45,  tmdbMovie: 35,    tmdbTV: 35 },
    { id: "crime",       label: "Crime",        hue: 30,  tmdbMovie: 80,    tmdbTV: 80 },
    { id: "documentary", label: "Documentary",  hue: 90,  tmdbMovie: 99,    tmdbTV: 99 },
    { id: "drama",       label: "Drama",        hue: 220, tmdbMovie: 18,    tmdbTV: 18 },
    { id: "family",      label: "Family",       hue: 120, tmdbMovie: 10751, tmdbTV: 10751 },
    { id: "fantasy",     label: "Fantasy",      hue: 280, tmdbMovie: 14,    tmdbTV: 10765 },
    { id: "history",     label: "History",      hue: 35,  tmdbMovie: 36,    tmdbTV: 18 },
    { id: "horror",      label: "Horror",       hue: 0,   tmdbMovie: 27,    tmdbTV: 9648 },
    { id: "mystery",     label: "Mystery",      hue: 250, tmdbMovie: 9648,  tmdbTV: 9648 },
    { id: "romance",     label: "Romance",      hue: 340, tmdbMovie: 10749, tmdbTV: 18 },
    { id: "sci-fi",      label: "Sci-Fi",       hue: 195, tmdbMovie: 878,   tmdbTV: 10765 },
    { id: "thriller",    label: "Thriller",     hue: 270, tmdbMovie: 53,    tmdbTV: 80 },
    { id: "war",         label: "War",          hue: 10,  tmdbMovie: 10752, tmdbTV: 10768 },
    { id: "western",     label: "Western",      hue: 25,  tmdbMovie: 37,    tmdbTV: 37 },
];

export const COUNTRIES: Country[] = [
    { id: "US", label: "USA",     flag: "🇺🇸", hue: 220 },
    { id: "JP", label: "Japan",   flag: "🇯🇵", hue: 0 },
    { id: "IN", label: "India",   flag: "🇮🇳", hue: 30 },
    { id: "KR", label: "Korea",   flag: "🇰🇷", hue: 210 },
    { id: "GB", label: "UK",      flag: "🇬🇧", hue: 240 },
    { id: "FR", label: "France",  flag: "🇫🇷", hue: 225 },
    { id: "ES", label: "Spain",   flag: "🇪🇸", hue: 5 },
    { id: "TR", label: "Turkey",  flag: "🇹🇷", hue: 0 },
    { id: "BR", label: "Brazil",  flag: "🇧🇷", hue: 140 },
    { id: "DE", label: "Germany", flag: "🇩🇪", hue: 45 },
];

/** Cinemeta base URL (free, no API key) */
export const CINEMETA_BASE = "https://v3-cinemeta.strem.io";
