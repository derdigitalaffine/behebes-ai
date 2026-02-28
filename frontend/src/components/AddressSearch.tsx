import React, { useState, useRef, useEffect } from 'react';
import axios from 'axios';
import './AddressSearch.css';
import { useI18n } from '../i18n/I18nProvider';

interface AddressSuggestion {
  address: string;
  city: string;
  postalCode: string;
  latitude: number;
  longitude: number;
  displayText: string;
}

interface AddressSearchProps {
  value?: string;
  onChange?: (value: string) => void;
  suppressAutocomplete?: boolean;
  autocompleteEnabled?: boolean;
  onAddressSelect: (location: {
    address: string;
    city: string;
    postalCode: string;
    latitude: number;
    longitude: number;
  }) => void;
}

const AddressSearch: React.FC<AddressSearchProps> = ({
  value,
  onChange,
  suppressAutocomplete = false,
  autocompleteEnabled = true,
  onAddressSelect,
}) => {
  const { t } = useI18n();
  const [searchInput, setSearchInput] = useState('');
  const [suggestions, setSuggestions] = useState<AddressSuggestion[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [lockAddressInput, setLockAddressInput] = useState(true);
  const debounceTimer = useRef<NodeJS.Timeout | null>(null);
  const skipNextFetch = useRef(false);
  const lastSelected = useRef<string>('');
  const latestQueryId = useRef(0);
  const pointerUnlockRequested = useRef(false);
  const tabNavigationUnlockRequested = useRef(false);
  const tabUnlockResetTimer = useRef<number | null>(null);
  const canAutocomplete = autocompleteEnabled && !suppressAutocomplete;

  useEffect(() => {
    const clearTabUnlockTimer = () => {
      if (tabUnlockResetTimer.current !== null) {
        window.clearTimeout(tabUnlockResetTimer.current);
        tabUnlockResetTimer.current = null;
      }
    };
    const onDocumentKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Tab') {
        tabNavigationUnlockRequested.current = true;
        clearTabUnlockTimer();
        tabUnlockResetTimer.current = window.setTimeout(() => {
          tabNavigationUnlockRequested.current = false;
          tabUnlockResetTimer.current = null;
        }, 0);
        return;
      }
      tabNavigationUnlockRequested.current = false;
      clearTabUnlockTimer();
    };
    document.addEventListener('keydown', onDocumentKeyDown, true);
    return () => {
      document.removeEventListener('keydown', onDocumentKeyDown, true);
      clearTabUnlockTimer();
    };
  }, []);

  useEffect(() => {
    if (typeof value === 'string' && value !== searchInput) {
      if (!canAutocomplete) {
        skipNextFetch.current = true;
        latestQueryId.current += 1;
        lastSelected.current = value.trim();
        setSuggestions([]);
        setIsOpen(false);
        setIsLoading(false);
      }
      setSearchInput(value);
    }
  }, [value, searchInput, canAutocomplete]);

  const fetchSuggestions = async (query: string, limit = 5): Promise<AddressSuggestion[]> => {
    const response = await axios.get('https://nominatim.openstreetmap.org/search', {
      params: {
        q: query,
        format: 'json',
        addressdetails: 1,
        limit,
        countrycodes: 'de',
      },
    });

    return response.data.map((result: any) => {
      const address = result.address;
      const road = address.road || '';
      const houseNumber = address.house_number ? ` ${address.house_number}` : '';
      const postalCode = address.postcode || '';
      const city = address.city || address.town || address.village || '';

      return {
        address: `${road}${houseNumber}`.trim(),
        city,
        postalCode,
        latitude: parseFloat(result.lat),
        longitude: parseFloat(result.lon),
        displayText: [
          `${road}${houseNumber}`.trim(),
          postalCode,
          city,
        ]
          .filter(Boolean)
          .join(', '),
      };
    });
  };

  // Debounced search via Nominatim Geocoding API
  useEffect(() => {
    if (debounceTimer.current) {
      clearTimeout(debounceTimer.current);
    }

    if (!canAutocomplete) {
      setIsLoading(false);
      setSuggestions([]);
      setIsOpen(false);
      return;
    }

    if (skipNextFetch.current) {
      skipNextFetch.current = false;
      setIsLoading(false);
      setSuggestions([]);
      setIsOpen(false);
      return;
    }

    if (lastSelected.current && searchInput.trim() === lastSelected.current.trim()) {
      setIsLoading(false);
      setSuggestions([]);
      setIsOpen(false);
      return;
    }

    if (!searchInput.trim()) {
      setSuggestions([]);
      setIsOpen(false);
      return;
    }

    setIsLoading(true);
    const queryId = ++latestQueryId.current;

    debounceTimer.current = setTimeout(async () => {
      try {
        const parsedSuggestions = await fetchSuggestions(searchInput, 5);
        if (queryId !== latestQueryId.current || skipNextFetch.current) {
          return;
        }
        setSuggestions(parsedSuggestions);
        setIsOpen(parsedSuggestions.length > 0);
      } catch (error) {
        console.error('Nominatim search error:', error);
        if (queryId !== latestQueryId.current) {
          return;
        }
        setSuggestions([]);
      } finally {
        if (queryId === latestQueryId.current) {
          setIsLoading(false);
        }
      }
    }, 300); // 300ms debounce
  }, [searchInput, canAutocomplete]);

  const handleSelectSuggestion = (suggestion: AddressSuggestion) => {
    skipNextFetch.current = true;
    latestQueryId.current += 1;
    lastSelected.current = suggestion.displayText;
    setSearchInput(suggestion.displayText);
    setIsOpen(false);
    setSuggestions([]);
    setIsLoading(false);

    onAddressSelect({
      address: suggestion.displayText,
      city: suggestion.city,
      postalCode: suggestion.postalCode,
      latitude: suggestion.latitude,
      longitude: suggestion.longitude,
    });
  };

  const handleInputChange = (value: string) => {
    skipNextFetch.current = false;
    setSearchInput(value);
    if (value !== lastSelected.current) {
      lastSelected.current = '';
    }
    onChange?.(value);
  };

  const handleInputKeyDown = async (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    if (suggestions.length > 0) {
      handleSelectSuggestion(suggestions[0]);
      return;
    }

    if (!searchInput.trim()) return;

    setIsLoading(true);
    try {
      const results = await fetchSuggestions(searchInput, 1);
      if (results.length > 0) {
        handleSelectSuggestion(results[0]);
      }
    } catch (error) {
      console.error('Nominatim search error:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleInputBlur = () => {
    if (skipNextFetch.current) {
      setIsOpen(false);
      return;
    }
    setIsOpen(false);
  };

  const unlockAddressInput = () => {
    pointerUnlockRequested.current = true;
    if (lockAddressInput) {
      setLockAddressInput(false);
    }
  };

  const handleInputFocus = (event: React.FocusEvent<HTMLInputElement>) => {
    if (lockAddressInput) {
      if (pointerUnlockRequested.current || tabNavigationUnlockRequested.current) {
        setLockAddressInput(false);
      } else {
        // Browser autofill can force focus here; immediately release focus to avoid a scroll jump.
        event.currentTarget.blur();
        return;
      }
    }
    pointerUnlockRequested.current = false;
    tabNavigationUnlockRequested.current = false;
    if (searchInput && suggestions.length > 0) {
      setIsOpen(true);
    }
  };

  return (
    <div className="address-search-container">
      <div className="search-input-wrapper">
        <input
          type="search"
          name="citizen_location_query"
          placeholder={t('address_placeholder')}
          value={searchInput}
          onChange={(e) => handleInputChange(e.target.value)}
          onKeyDown={handleInputKeyDown}
          onBlur={handleInputBlur}
          onFocus={handleInputFocus}
          onMouseDown={unlockAddressInput}
          onTouchStart={unlockAddressInput}
          className="address-search-input"
          autoComplete="new-password"
          readOnly={lockAddressInput}
          autoCorrect="off"
          autoCapitalize="none"
          spellCheck={false}
          data-lpignore="true"
          data-1p-ignore="true"
          data-bwignore="true"
          aria-autocomplete="list"
        />
        {isLoading && (
          <div className="search-spinner">
            <i className="fa-solid fa-spinner" />
          </div>
        )}
      </div>

      {isOpen && suggestions.length > 0 && (
        <div className="suggestions-dropdown">
          {suggestions.map((suggestion, index) => (
            <div
              key={index}
              className="suggestion-item"
              onMouseDown={(e) => {
                e.preventDefault();
                handleSelectSuggestion(suggestion);
              }}
            >
              <div className="suggestion-icon">
                <i className="fa-solid fa-location-dot" aria-hidden="true" />
              </div>
              <div className="suggestion-text">
                <div className="suggestion-address">{suggestion.address}</div>
                <div className="suggestion-detail">
                  {suggestion.postalCode} {suggestion.city}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {isOpen && searchInput && suggestions.length === 0 && !isLoading && (
        <div className="suggestions-dropdown">
          <div className="suggestion-empty">
            {t('address_no_results')}
          </div>
        </div>
      )}

    </div>
  );
};

export default AddressSearch;
