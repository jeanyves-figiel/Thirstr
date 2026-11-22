defmodule Thirstr.Help do
  @moduledoc """
  F-22 R-22.5: "Was this helpful?" counts per article / language / day. No account, no device.
  A 👎 note is scrubbed (Support.Scrub) and kept 90 days for the team to improve the article.
  """
  alias Thirstr.Repo
  alias Thirstr.Support.Scrub

  @reasons ~w(not_answered hard out_of_date)
  @langs ~w(en fr de)

  def vote(%{"article" => art, "lang" => lang, "helpful" => h} = p)
      when is_binary(art) and is_boolean(h) do
    lang = if lang in @langs, do: lang, else: "en"
    reason = if p["reason"] in @reasons, do: p["reason"]

    if Regex.match?(~r/^[a-z0-9-]{2,60}$/, art) do
      {up, down} = if h, do: {1, 0}, else: {0, 1}

      Repo.query!(
        """
        INSERT INTO help_votes (article, lang, day, up, down, reasons)
        VALUES ($1, $2, current_date, $3, $4, $5)
        ON CONFLICT (article, lang, day) DO UPDATE SET up = help_votes.up + $3, down = help_votes.down + $4,
          reasons = CASE WHEN $6::text IS NULL THEN help_votes.reasons
            ELSE jsonb_set(help_votes.reasons, ARRAY[$6::text], to_jsonb(coalesce((help_votes.reasons->>$6::text)::int, 0) + 1)) END
        """,
        [art, lang, up, down, if(reason, do: %{reason => 1}, else: %{}), reason]
      )

      note = p["note"]

      if not h and is_binary(note) and String.trim(note) != "" do
        Repo.insert_all("help_notes", [
          %{
            article: art,
            lang: lang,
            reason: reason,
            note: note |> String.slice(0, 200) |> Scrub.scrub()
          }
        ])
      end

      :ok
    else
      {:error, {:validation, %{article: ["unknown"]}}}
    end
  end

  def vote(_), do: {:error, {:validation, %{helpful: ["required"]}}}

  @doc "Admin: last 30 days per article, worst first."
  def stats do
    Repo.query!(
      """
      SELECT article, sum(up)::int, sum(down)::int FROM help_votes
      WHERE day > current_date - 30 GROUP BY article ORDER BY sum(down) - sum(up) DESC LIMIT 50
      """,
      []
    ).rows
  end

  def notes do
    Repo.query!(
      "SELECT article, lang, reason, note, created_at FROM help_notes ORDER BY id DESC LIMIT 50",
      []
    ).rows
  end

  def sweep do
    %{num_rows: n} =
      Repo.query!("DELETE FROM help_notes WHERE created_at < now() - interval '90 days'", [])

    n
  end
end
