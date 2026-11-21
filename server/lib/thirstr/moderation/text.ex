defmodule Thirstr.Moderation.Text do
  @moduledoc """
  Write-time text checks. R-06.12: no phone numbers / emails in bios; links blocked during
  the first 24 h and always for unverified accounts. R-06.13 / R-15.12: discriminatory
  phrases get an inline nudge. R-07.3 mirrors the link rule for first messages (client side).
  """

  @email ~r/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i
  @phone ~r/(?:\+|00)?\d[\d\s().\/-]{7,}\d/
  @link ~r/(https?:\/\/|www\.|\b[a-z0-9-]+\.(com|net|org|app|fun|me|io|ly|gg|co|de|fr|ch|link|xyz|onlyfans)\b)/i

  # Short, conservative list; extended per locale by the moderation team (en/fr/de beta).
  @discriminatory [
    ~r/\bno\s+(fats?|fems?|asians?|blacks?|arabs?|latinos?|indians?|old(ies)?|trans)\b/i,
    ~r/\b(whites?|masc)\s+only\b/i,
    ~r/\bpas\s+de\s+(gros|folles|asiatiques|noirs|arabes|rebeus?)\b/i,
    ~r/\bkeine\s+(dicken|tunten|asiaten|schwarzen|araber)\b/i
  ]

  def contact_details?(text), do: Regex.match?(@email, text) or Regex.match?(@phone, text)
  def link?(text), do: Regex.match?(@link, text)
  def discriminatory?(text), do: Enum.any?(@discriminatory, &Regex.match?(&1, text))

  @doc "Checks a free-text profile value. `links_ok?` = verified and account older than 24 h."
  def check_bio(nil, _), do: :ok

  def check_bio(text, links_ok?) do
    cond do
      contact_details?(text) ->
        {:error, "no phone numbers or emails"}

      link?(text) and not links_ok? ->
        {:error, "links are allowed after 24 h once you're verified"}

      true ->
        :ok
    end
  end
end
