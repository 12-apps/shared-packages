import Alert from '@mui/material/Alert/index.js';
import Box from '@mui/material/Box/index.js';
import Button from '@mui/material/Button/index.js';
import Paper from '@mui/material/Paper/index.js';
import Stack from '@mui/material/Stack/index.js';
import Typography from '@mui/material/Typography/index.js';
import type { Meta, StoryObj } from '@storybook/react-vite';
import React from 'react';

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
      options: ['outlined', 'filled', 'standard'],
      description: 'Input field variant',
    },
    defaultCountry: {
      control: 'text',
      description: 'Default country code (e.g., "US", "GB")',
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
    helperText: {
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
  const [value, setValue] = React.useState('');

  return (
    <Box sx={{ maxWidth: 400 }}>
      <PhoneInput copy={PT_BR_PHONE_INPUT_COPY} value={value} onChange={setValue} label="Phone Number" defaultCountry="US" />
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
    const countries = [
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
              <PhoneInput copy={PT_BR_PHONE_INPUT_COPY}
                defaultCountry={country.code}
                placeholder={country.example}
                label="Phone"
                variant="outlined"
                size="small"
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
  const [helperText, setHelperText] = React.useState('');

  const validatePhone = (value: string) => {
    // Simple validation - check if it has at least 10 digits
    const digitsOnly = value.replace(/\D/g, '');
    if (digitsOnly.length < 10) {
      setError(true);
      setHelperText('Please enter a valid phone number');
      return false;
    }
    setError(false);
    setHelperText('');
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
        value={phone}
        onChange={(value) => {
          setPhone(value);
          if (value) validatePhone(value);
        }}
        label="Contact Number"
        required
        error={error}
        helperText={helperText}
        defaultCountry="US"
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
            value={formData.phone}
            onChange={(value) => setFormData({ ...formData, phone: value })}
            label="Primary Phone"
            required
            defaultCountry="US"
          />

          <PhoneInput copy={PT_BR_PHONE_INPUT_COPY}
            value={formData.alternatePhone}
            onChange={(value) => setFormData({ ...formData, alternatePhone: value })}
            label="Alternate Phone (Optional)"
            defaultCountry="US"
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
  render: () => (
      <Stack spacing={3}>
        <Typography variant="h6">Input Variants</Typography>

        <PhoneInput copy={PT_BR_PHONE_INPUT_COPY}
          label="Outlined"
          variant="outlined"
          defaultCountry="US"
          placeholder="+1 (555) 000-0000"
        />

        <PhoneInput copy={PT_BR_PHONE_INPUT_COPY}
          label="Filled"
          variant="filled"
          defaultCountry="US"
          placeholder="+1 (555) 000-0000"
        />

        <PhoneInput copy={PT_BR_PHONE_INPUT_COPY}
          label="Standard"
          variant="standard"
          defaultCountry="US"
          placeholder="+1 (555) 000-0000"
        />
      </Stack>
    ),
};

export const WithCountryRestrictions: Story = {
  render: () => (
      <Stack spacing={3}>
        <Typography variant="h6">Regional Phone Numbers</Typography>

        <Paper sx={{ p: 2 }}>
          <Typography variant="subtitle2" gutterBottom>
            North America Only
          </Typography>
          <PhoneInput copy={PT_BR_PHONE_INPUT_COPY}
            label="Phone"
            defaultCountry="US"
            onlyCountries={['US', 'CA', 'MX']}
            helperText="US, Canada, and Mexico only"
          />
        </Paper>

        <Paper sx={{ p: 2 }}>
          <Typography variant="subtitle2" gutterBottom>
            European Union
          </Typography>
          <PhoneInput copy={PT_BR_PHONE_INPUT_COPY}
            label="Phone"
            defaultCountry="FR"
            onlyCountries={['FR', 'DE', 'IT', 'ES', 'NL', 'BE']}
            helperText="EU countries only"
          />
        </Paper>

        <Paper sx={{ p: 2 }}>
          <Typography variant="subtitle2" gutterBottom>
            Asia Pacific
          </Typography>
          <PhoneInput copy={PT_BR_PHONE_INPUT_COPY}
            label="Phone"
            defaultCountry="JP"
            onlyCountries={['JP', 'CN', 'KR', 'SG', 'AU', 'NZ']}
            helperText="APAC region only"
          />
        </Paper>
      </Stack>
    ),
};

export const DisabledAndReadOnly: Story = {
  render: () => (
      <Stack spacing={3}>
        <PhoneInput copy={PT_BR_PHONE_INPUT_COPY} label="Disabled" defaultCountry="US" value="+1 (555) 123-4567" disabled />

        <PhoneInput copy={PT_BR_PHONE_INPUT_COPY} label="Read Only" defaultCountry="GB" value="+44 20 7123 4567" readOnly />
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
            value={contact.phone}
            onChange={(value) => updateContact(contact.id, value)}
            label="Phone Number"
            defaultCountry="US"
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
  parameters: {
    viewport: { defaultViewport: 'responsive' },
  },
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
  parameters: {
    viewport: { defaultViewport: 'responsive' },
  },
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
  parameters: {
    viewport: { defaultViewport: 'responsive' },
  },
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
  parameters: {
    viewport: { defaultViewport: 'responsive' },
  },
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
  parameters: {
    viewport: { defaultViewport: 'responsive' },
  },
};
