defmodule Thirstr.Support.Scrub do
  @moduledoc """
  F-22 R-22.31: removes personal data from free text before it leaves for GitHub (feedback) or is
  kept as an anonymous help note. Best effort, deliberately greedy: a false "[removed]" costs
  nothing, a leaked phone number does.
  """
  @r "[removed]"

  @patterns [
    # emails
    ~r/[\w.+\-]+\s*(@|\(at\)|\[at\])\s*[\w\-]+(\.[\w\-]+)+/iu,
    # URLs and bare domains
    ~r/\b(?:https?:\/\/|www\.)\S+/iu,
    ~r/\b[\w\-]+\.(?:com|net|org|fun|app|ch|de|fr|at|uk|io|me|co|be|nl|it|es|eu|info|xyz)\b(\/\S*)?/iu,
    # GPS coordinates
    ~r/-?\d{1,3}\.\d{3,}\s*,\s*-?\d{1,3}\.\d{3,}/u,
    # IBAN
    ~r/\b[A-Z]{2}\d{2}(?:\s?[A-Z0-9]{4}){2,7}(?:\s?[A-Z0-9]{1,4})?\b/u,
    # phone numbers and long digit runs (cards, ids): 7+ digits with common separators
    ~r/\+?\(?\d(?:[\s().\/\-]*\d){6,}/u,
    # @handles
    ~r/(?<![\w])@[\w.]{2,}/u,
    # street addresses: number + street word, or street word + number (en/fr/de)
    ~r/\b\d{1,4}[a-z]?,?\s+(?:rue|avenue|av\.|boulevard|bd|chemin|place|street|st\.|road|rd\.|lane|ave)\b[^\n,.;]*/iu,
    ~r/\b[\p{L}\-]*(?:strasse|straße|str\.|gasse|weg|platz|allee)\s+\d{1,4}[a-z]?\b/iu,
    ~r/\b(?:rue|avenue|boulevard|chemin)\s+(?:de\s+la\s+|de\s+l'|du\s+|des\s+|de\s+)?[\p{L}\-']+\s+\d{1,4}\b/iu
  ]

  @doc "Scrubs `text`; `names` are the sender's own profile names (removed as whole words)."
  def scrub(text, names \\ []) when is_binary(text) do
    text =
      Enum.reduce(@patterns, text, fn re, acc -> Regex.replace(re, acc, @r) end)

    names
    |> Enum.filter(&(is_binary(&1) and String.length(String.trim(&1)) >= 2))
    |> Enum.reduce(text, fn n, acc ->
      Regex.replace(~r/(?<![\p{L}])#{Regex.escape(String.trim(n))}(?![\p{L}])/iu, acc, @r)
    end)
    |> String.replace(~r/(\[removed\]\s*){2,}/u, @r <> " ")
    |> String.trim()
  end

  # Words that make us keep a text in the admin inbox instead of sending it on (R-22.31).
  # Small on purpose; the moderation text classifier replaces it when it exists.
  @hold ~w(nigger nigga faggot fagot schwuchtel pédé pede tapette kike retard tranny
           cunt fotze salope hure whore pute kill-yourself kys suicide)

  @doc "True when the text should be held for a human (abuse, slurs, self-harm)."
  def hold?(text) do
    words =
      text
      |> String.downcase()
      |> String.replace(~r/kill\s+yourself/u, "kill-yourself")
      |> String.split(~r/[^\p{L}\-]+/u, trim: true)

    Enum.any?(words, &(&1 in @hold))
  end
end
