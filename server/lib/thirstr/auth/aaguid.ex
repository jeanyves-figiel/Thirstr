defmodule Thirstr.Auth.Aaguid do
  @moduledoc """
  F-01 R-01.16: passkey provider name from the authenticator's AAGUID (a model id shared by
  every user of that provider, so it identifies no one). Unknown or zeroed → "Passkey".
  Source: community list passkey-authenticator-aaguids.
  """

  @names %{
    "fbfc3007-154e-4ecc-8c0b-6e020557d7bd" => "iCloud Keychain",
    "dd4ec289-e01d-41c9-bb89-70fa845d4bf2" => "iCloud Keychain",
    "ea9b8d66-4d01-1d21-3ce4-b6b48cb575d4" => "Google Password Manager",
    "adce0002-35bc-c60a-648b-0b25f1f05503" => "Chrome on Mac",
    "bada5566-a7aa-401f-bd96-45619a55120d" => "1Password",
    "d548826e-79b4-db40-a3d8-11116f7e8349" => "Bitwarden",
    "531126d6-e717-415c-9320-3d9aa6981239" => "Dashlane",
    "08987058-cadc-4b81-b6e1-30de50dcbe96" => "Windows Hello",
    "9ddd1817-af5a-4672-a2b9-3e3dd95000a9" => "Windows Hello",
    "6028b017-b1d4-4c02-b4b3-afcdafc96bb2" => "Windows Hello",
    "53414d53-554e-4700-0000-000000000000" => "Samsung Pass"
  }

  def name(<<_::binary-16>> = bin) do
    case Ecto.UUID.load(bin) do
      {:ok, uuid} -> Map.get(@names, uuid, "Passkey")
      _ -> "Passkey"
    end
  end

  def name(_), do: "Passkey"
end
