import Alert from '@mui/material/Alert/index.js';
import Box from '@mui/material/Box/index.js';
import Button from '@mui/material/Button/index.js';
import Paper from '@mui/material/Paper/index.js';
import Stack from '@mui/material/Stack/index.js';
import Typography from '@mui/material/Typography/index.js';
import type { Meta, StoryObj } from '@storybook/react-vite';
import React from 'react';

import type { CountryCode } from 'libphonenumber-js';

import { PhoneInput } from './PhoneInput';
import { PT_BR_PHONE_INPUT_COPY } from '../../../pt-BR';

const meta: Meta<typeof PhoneInput> = {
  args: { copy: PT_BR_PHONE_INPUT_COPY },
  title: 'Form/PhoneInput',
  component: PhoneInput,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'An international phone number input component with country selection, validation, and formatting.',
      },
    },
  },
  tags: ['autodocs', 'component:PhoneInput'],
  argTypes: {
    variant: {
      control: { type: 'select' },
      options: ['outlined', 'filled', 'glass'],
      description: 'Input field variant',
    },
    countryCode: {
      control: 'text',
      description: 'Starting country (e.g., "US", "GB")',
    },
    label: {
      control: 'text',
      description: 'Input label',
    },
    placeholder: {
      control: 'text',
      description: 'Placeholder text',
    },
    disabled: {
      control: 'boolean',
      description: 'Disable the input',
    },
    required: {
      control: 'boolean',
      description: 'Mark as required field',
    },
    error: {
      control: 'boolean',
      description: 'Show error state',
    },
    helper: {
      control: 'text',
      description: 'Helper text below input',
    },
    fullWidth: {
      control: 'boolean',
      description: 'Take full width of container',
    },
  },
};

export default meta;
type Story = StoryObj<typeof meta>;

const DefaultComponent = () => {
  // Uncontrolled: the field owns its own text, so the story reads it back
  // through `onChange` rather than feeding a `value` prop back in.
  const [value, setValue] = React.useState('');

  return (
    <Box sx={{ maxWidth: 400 }}>
      <PhoneInput
        copy={PT_BR_PHONE_INPUT_COPY}
        onChange={(newValue) => setValue(newValue)}
        label="Phone Number"
        countryCode="US"
      />
      {value && (
        <Typography variant="caption" sx={{ mt: 1, display: 'block' }}>
          Value: {value}
        </Typography>
      )}
    </Box>
  );
};

export const Default: Story = {
  render: () => <DefaultComponent />,
};

export const InternationalNumbers: Story = {
  render: () => {
    const countries: Array<{ code: CountryCode; name: string; example: string }> = [
      { code: 'US', name: 'United States', example: '+1 (555) 123-4567' },
      { code: 'GB', name: 'United Kingdom', example: '+44 20 7123 4567' },
      { code: 'FR', name: 'France', example: '+33 1 23 45 67 89' },
      { code: 'DE', name: 'Germany', example: '+49 30 12345678' },
      { code: 'JP', name: 'Japan', example: '+81 3-1234-5678' },
      { code: 'AU', name: 'Australia', example: '+61 2 1234 5678' },
    ];

    return (
      <Stack spacing={3}>
        <Typography variant="h6">International Phone Numbers</Typography>

        <Box display="grid" gridTemplateColumns="1fr 1fr" gap={2}>
          {countries.map((country) => (
            <Paper key={country.code} sx={{ p: 2 }}>
              <Typography variant="subtitle2" gutterBottom>
                {country.name}
              </Typography>
              {/* No `size` prop — the component only ever renders at one size; `fullWidth` is its one layout knob. */}
              <PhoneInput copy={PT_BR_PHONE_INPUT_COPY}
                countryCode={country.code}
                placeholder={country.example}
                label="Phone"
                variant="outlined"
                fullWidth
              />
            </Paper>
          ))}
        </Box>
      </Stack>
    );
  },
};

const WithValidationComponent = () => {
  const [phone, setPhone] = React.useState('');
  const [error, setError] = React.useState(false);
  const [errorMessage, setErrorMessage] = React.useState('');

  const validatePhone = (value: string) => {
    // Simple validation - check if it has at least 10 digits
    const digitsOnly = value.replace(/\D/g, '');
    if (digitsOnly.length < 10) {
      setError(true);
      setErrorMessage('Please enter a valid phone number');
      return false;
    }
    setError(false);
    setErrorMessage('');
    return true;
  };

  const handleSubmit = () => {
    if (validatePhone(phone)) {
      // Phone number saved: ${phone} - would integrate with form submission
    }
  };

  return (
    <Stack spacing={3} sx={{ maxWidth: 400 }}>
      <Typography variant="h6">Phone Validation Example</Typography>

      <PhoneInput copy={PT_BR_PHONE_INPUT_COPY}
        onChange={(value) => {
          setPhone(value);
          if (value) validatePhone(value);
        }}
        label="Contact Number"
        required
        error={error}
        errorMessage={errorMessage}
        countryCode="US"
      />

      <Button variant="contained" onClick={handleSubmit} disabled={!phone || error}>
        Save Phone Number
      </Button>
    </Stack>
  );
};

export const WithValidation: Story = {
  render: () => <WithValidationComponent />,
};

const ContactFormComponent = () => {
  const [formData, setFormData] = React.useState({
    name: '',
    email: '',
    phone: '',
    alternatePhone: '',
  });

  return (
    <Stack spacing={3} sx={{ maxWidth: 500 }}>
      <Typography variant="h6">Contact Information</Typography>

      <Paper sx={{ p: 3 }}>
        <Stack spacing={2}>
          <input
            placeholder="Full Name"
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            style={{ padding: '10px' }}
          />

          <input
            placeholder="Email Address"
            type="email"
            value={formData.email}
            onChange={(e) => setFormData({ ...formData, email: e.target.value })}
            style={{ padding: '10px' }}
          />

          <PhoneInput copy={PT_BR_PHONE_INPUT_COPY}
            onChange={(value) => setFormData({ ...formData, phone: value })}
            label="Primary Phone"
            required
            countryCode="US"
          />

          <PhoneInput copy={PT_BR_PHONE_INPUT_COPY}
            onChange={(value) => setFormData({ ...formData, alternatePhone: value })}
            label="Alternate Phone (Optional)"
            countryCode="US"
          />
        </Stack>
      </Paper>

      {formData.phone && (
        <Alert severity="info">
          Primary: {formData.phone}
          {formData.alternatePhone && <br />}
          {formData.alternatePhone && `Alternate: ${formData.alternatePhone}`}
        </Alert>
      )}
    </Stack>
  );
};

export const ContactForm: Story = {
  render: () => <ContactFormComponent />,
};

export const DifferentVariants: Story = {
  parameters: {
    docs: {
      description: {
        // `standard` was never a real variant here — the component only ever
        // supported outlined/filled/glass — so this example now shows the
        // three that actually exist instead of documenting one that doesn't.
        story: 'The three real input variants: outlined, filled, and glass.',
      },
    },
  },
  render: () => (
      <Stack spacing={3}>
        <Typography variant="h6">Input Variants</Typography>

        <PhoneInput copy={PT_BR_PHONE_INPUT_COPY}
          label="Outlined"
          variant="outlined"
          countryCode="US"
          placeholder="+1 (555) 000-0000"
        />

        <PhoneInput copy={PT_BR_PHONE_INPUT_COPY}
          label="Filled"
          variant="filled"
          countryCode="US"
          placeholder="+1 (555) 000-0000"
        />

        <PhoneInput copy={PT_BR_PHONE_INPUT_COPY}
          label="Glass"
          variant="glass"
          countryCode="US"
          placeholder="+1 (555) 000-0000"
        />
      </Stack>
    ),
};

export const WithCountryRestrictions: Story = {
  parameters: {
    docs: {
      description: {
        // The component never re-gained a country allow-list after this was
        // written — `onlyCountries` isn't a prop. The picker always offers
        // every country; a region-specific field can only steer its STARTING
        // selection via `countryCode`, which is what this example now shows.
        story:
          "There is no country allow-list — the picker always lists every country. `countryCode` only sets which one is preselected, so a region-specific field steers the starting point and explains the expectation in its own helper text.",
      },
    },
  },
  render: () => (
      <Stack spacing={3}>
        <Typography variant="h6">Regional Phone Numbers</Typography>

        <Paper sx={{ p: 2 }}>
          <Typography variant="subtitle2" gutterBottom>
            North America
          </Typography>
          <PhoneInput copy={PT_BR_PHONE_INPUT_COPY}
            label="Phone"
            countryCode="US"
            helper="Starts on the US — pick Canada or Mexico from the list if needed"
          />
        </Paper>

        <Paper sx={{ p: 2 }}>
          <Typography variant="subtitle2" gutterBottom>
            European Union
          </Typography>
          <PhoneInput copy={PT_BR_PHONE_INPUT_COPY}
            label="Phone"
            countryCode="FR"
            helper="Starts on France — any EU country can be picked from the list"
          />
        </Paper>

        <Paper sx={{ p: 2 }}>
          <Typography variant="subtitle2" gutterBottom>
            Asia Pacific
          </Typography>
          <PhoneInput copy={PT_BR_PHONE_INPUT_COPY}
            label="Phone"
            countryCode="JP"
            helper="Starts on Japan — any APAC country can be picked from the list"
          />
        </Paper>
      </Stack>
    ),
};

export const DisabledAndReadOnly: Story = {
  parameters: {
    docs: {
      description: {
        // There is no `readOnly` prop — `disabled` is the only way to stop
        // editing, and it also greys the field out. This example shows the
        // one state the component actually has, rather than a second one it
        // does not.
        story: '`disabled` is the only non-editable state the component supports — there is no separate read-only look.',
      },
    },
  },
  render: () => (
      <Stack spacing={3}>
        <PhoneInput copy={PT_BR_PHONE_INPUT_COPY} label="Disabled" countryCode="US" defaultValue="+1 (555) 123-4567" disabled />
      </Stack>
    ),
};

const EmergencyContactsComponent = () => {
  const [contacts, setContacts] = React.useState([
    { id: 1, name: 'Primary Contact', phone: '' },
    { id: 2, name: 'Secondary Contact', phone: '' },
    { id: 3, name: 'Emergency Contact', phone: '' },
  ]);

  const updateContact = (id: number, phone: string) => {
    setContacts(contacts.map((c) => (c.id === id ? { ...c, phone } : c)));
  };

  return (
    <Stack spacing={3}>
      <Typography variant="h6">Emergency Contact List</Typography>

      {contacts.map((contact) => (
        <Paper key={contact.id} sx={{ p: 2 }}>
          <Typography variant="subtitle2" gutterBottom>
            {contact.name}
          </Typography>
          <PhoneInput copy={PT_BR_PHONE_INPUT_COPY}
            onChange={(value) => updateContact(contact.id, value)}
            label="Phone Number"
            countryCode="US"
            required={contact.id === 1}
            fullWidth
          />
        </Paper>
      ))}

      {contacts.filter((c) => c.phone).length > 0 && (
        <Alert severity="success">{contacts.filter((c) => c.phone).length} contact(s) added</Alert>
      )}
    </Stack>
  );
};

export const EmergencyContacts: Story = {
  render: () => <EmergencyContactsComponent />,
};

// Required test stories
export const AllVariants: Story = {
  render: () => (
    <Stack spacing={3} sx={{ width: 400 }}>
      <PhoneInput copy={PT_BR_PHONE_INPUT_COPY}
        label="Outlined Variant"
        variant="outlined"
        countryCode="US"
        placeholder="+1 (555) 000-0000"
      />
      <PhoneInput copy={PT_BR_PHONE_INPUT_COPY}
        label="Filled Variant"
        variant="filled"
        countryCode="US"
        placeholder="+1 (555) 000-0000"
      />
      <PhoneInput copy={PT_BR_PHONE_INPUT_COPY}
        label="Glass Variant"
        variant="glass"
        countryCode="US"
        placeholder="+1 (555) 000-0000"
      />
    </Stack>
  ),
};

export const AllSizes: Story = {
  render: () => (
    <Stack spacing={3} sx={{ width: 400 }}>
      <PhoneInput copy={PT_BR_PHONE_INPUT_COPY} label="Default Size" countryCode="US" placeholder="+1 (555) 000-0000" />
      <PhoneInput copy={PT_BR_PHONE_INPUT_COPY} label="Full Width" countryCode="US" placeholder="+1 (555) 000-0000" fullWidth />
      <PhoneInput copy={PT_BR_PHONE_INPUT_COPY}
        label="Not Full Width"
        countryCode="US"
        placeholder="+1 (555) 000-0000"
        fullWidth={false}
      />
    </Stack>
  ),
};

export const AllStates: Story = {
  render: () => (
    <Stack spacing={3} sx={{ width: 400 }}>
      <PhoneInput copy={PT_BR_PHONE_INPUT_COPY} label="Default State" countryCode="US" placeholder="Enter phone number" />
      <PhoneInput copy={PT_BR_PHONE_INPUT_COPY}
        label="Disabled State"
        countryCode="US"
        defaultValue="+1 (555) 123-4567"
        disabled
      />
      <PhoneInput copy={PT_BR_PHONE_INPUT_COPY}
        label="Error State"
        countryCode="US"
        defaultValue="invalid"
        error
        errorMessage="Invalid phone number format"
      />
      <PhoneInput copy={PT_BR_PHONE_INPUT_COPY} label="Required State" countryCode="US" placeholder="Required field" required />
      <PhoneInput copy={PT_BR_PHONE_INPUT_COPY}
        label="With Helper Text"
        countryCode="US"
        placeholder="Enter your phone"
        helper="We'll use this to contact you"
      />
    </Stack>
  ),
};

const InteractiveStatesComponent = () => {
  const [phone, setPhone] = React.useState('');
  const [isValid, setIsValid] = React.useState(false);

  const handleChange = (value: string, valid: boolean) => {
    setPhone(value);
    setIsValid(valid);
  };

  return (
    <Stack spacing={3} sx={{ width: 400 }}>
      <PhoneInput copy={PT_BR_PHONE_INPUT_COPY}
        label="Interactive Phone Input"
        countryCode="US"
        placeholder="Try typing a phone number"
        onChange={handleChange}
      />
      <Box sx={{ p: 2, bgcolor: 'background.paper', borderRadius: 1 }}>
        <Typography variant="body2">Current Value: {phone || 'None'}</Typography>
        <Typography variant="body2" color={isValid ? 'success.main' : 'error.main'}>
          Status: {isValid ? 'Valid' : 'Invalid'}
        </Typography>
      </Box>
    </Stack>
  );
};

export const InteractiveStates: Story = {
  render: () => <InteractiveStatesComponent />,
};

export const Responsive: Story = {
  render: () => (
    <Stack spacing={2}>
      <Typography variant="h6">Responsive Phone Input</Typography>
      <Box
        sx={{
          display: 'grid',
          gap: 2,
          gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr', md: '1fr 1fr 1fr' },
        }}
      >
        <PhoneInput copy={PT_BR_PHONE_INPUT_COPY} label="US Phone" countryCode="US" placeholder="+1 (555) 000-0000" fullWidth />
        <PhoneInput copy={PT_BR_PHONE_INPUT_COPY} label="UK Phone" countryCode="GB" placeholder="+44 20 0000 0000" fullWidth />
        <PhoneInput copy={PT_BR_PHONE_INPUT_COPY}
          label="France Phone"
          countryCode="FR"
          placeholder="+33 1 00 00 00 00"
          fullWidth
        />
      </Box>
    </Stack>
  ),
};
