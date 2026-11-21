# City catalogue (F-20)

`cities.tsv` (first line is a comment): GeoNames cities with at least 15 000 inhabitants plus a short list of smaller travel spots;
districts (PPLX, PPLH, PPLQ, PPLW) excluded. Columns: name, search key, country (ISO 3166-1 alpha-2),
lat, lng, population. Loaded by migration `20261121120001_travel_plans.exs` (`Thirstr.Cities.load!/1`).

Source: [GeoNames](https://www.geonames.org/), licensed under
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Shown in the app's city picker.
