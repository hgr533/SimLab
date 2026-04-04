import csv
import numpy as np
import os
import tempfile
import time
from dataclasses import dataclass
from typing import List, Dict, Tuple, Optional

# Check for CuPy availability
try:
    import cupy as cp

    GPU_AVAILABLE = True
    print(f"CuPy available: {cp.__version__}")
    # Verify GPU actually works
    test = cp.array([1, 2, 3])
    _ = cp.sum(test)
    print("GPU test successful")
except (ImportError, Exception) as e:
    print(f"GPU not available: {e}")
    cp = None
    GPU_AVAILABLE = False


# ========================================
# Configuration
# ========================================
@dataclass
class EnergyConfig:
    """Energy costs for different state transitions"""
    same_state: float = 0.1  # No change in state
    to_from_neutral: float = 1.0  # Transition involving neutral (0)
    opposite_states: float = 5.0  # Transition between -1 and +1


@dataclass
class TernaryConfig:
    """Configuration for ternary operations"""
    threshold_low: float = -0.5
    threshold_high: float = 0.5
    noise_sigma: float = 0.05
    energy_config: EnergyConfig = None

    def __post_init__(self):
        if self.energy_config is None:
            self.energy_config = EnergyConfig()


# ========================================
# Logic Gates (Corrected)
# ========================================
def ternary_and(a: np.ndarray, b: np.ndarray) -> np.ndarray:
    """Ternary AND: Element-wise minimum of two ternary arrays"""
    return np.minimum(a, b)


def ternary_or(a: np.ndarray, b: np.ndarray) -> np.ndarray:
    """Ternary OR: Element-wise maximum of two ternary arrays"""
    return np.maximum(a, b)


def ternary_not(a: np.ndarray) -> np.ndarray:
    """Ternary NOT: Inverts values (-1 ↔ +1, 0 stays 0)"""
    return -a


# ========================================
# Ternary Conversion
# ========================================
def to_ternary(x: np.ndarray, config: TernaryConfig) -> np.ndarray:
    """Convert continuous values to ternary (-1, 0, +1)"""
    x = np.asarray(x, dtype=np.float32)
    result = np.zeros_like(x, dtype=np.int8)
    result[x >= config.threshold_high] = 1
    result[x <= config.threshold_low] = -1
    return result


def to_bipolar(x: np.ndarray) -> np.ndarray:
    """Convert continuous values to bipolar (-1, +1)"""
    x = np.asarray(x, dtype=np.float32)
    result = np.sign(x)
    result[result == 0] = 1  # Map zeros to +1
    return result.astype(np.int8)


# ========================================
# Energy Calculation
# ========================================
def calculate_transition_energy(
        prev_state: np.ndarray,
        curr_state: np.ndarray,
        config: TernaryConfig
) -> np.ndarray:
    """
    Calculate energy cost for each neuron transition.

    Returns array of energy values, one per neuron.
    """
    prev = np.asarray(prev_state, dtype=np.int8).flatten()
    curr = np.asarray(curr_state, dtype=np.int8).flatten()

    if prev.shape != curr.shape:
        raise ValueError(f"State shapes must match: {prev.shape} vs {curr.shape}")

    energy = np.zeros_like(prev, dtype=np.float32)
    ec = config.energy_config

    # Same state: minimal energy
    same_mask = (prev == curr)
    energy[same_mask] = ec.same_state

    # Transitions involving neutral (0)
    neutral_mask = ((prev == 0) | (curr == 0)) & ~same_mask
    energy[neutral_mask] = ec.to_from_neutral

    # Opposite state transitions (-1 ↔ +1)
    opposite_mask = ((prev == -1) & (curr == 1)) | ((prev == 1) & (curr == -1))
    energy[opposite_mask] = ec.opposite_states

    return energy


# ========================================
# Layer Operations
# ========================================
class TernaryLayer:
    """Single layer of ternary neural network"""

    def __init__(
            self,
            weights: np.ndarray,
            biases: Optional[np.ndarray] = None,
            mode: str = "ternary"
    ):
        """
        Args:
            weights: Shape (num_outputs, num_inputs)
            biases: Shape (num_outputs,), optional
            mode: "ternary" or "bipolar"
        """
        self.weights = np.asarray(weights, dtype=np.float32)

        if biases is None:
            self.biases = np.zeros(self.weights.shape[0], dtype=np.float32)
        else:
            self.biases = np.asarray(biases, dtype=np.float32)

        if self.biases.shape[0] != self.weights.shape[0]:
            raise ValueError(f"Bias shape {self.biases.shape} doesn't match weight output {self.weights.shape[0]}")

        self.mode = mode
        if mode not in ["ternary", "bipolar"]:
            raise ValueError(f"Mode must be 'ternary' or 'bipolar', got '{mode}'")

    def forward(
            self,
            inputs: np.ndarray,
            config: TernaryConfig,
            add_noise: bool = False
    ) -> np.ndarray:
        """
        Forward pass through the layer.

        Args:
            inputs: Input vector, shape (num_inputs,)
            config: Configuration for thresholds
            add_noise: Whether to add Gaussian noise to weights

        Returns:
            Output activations in ternary/bipolar form
        """
        inputs = np.asarray(inputs, dtype=np.float32).flatten()

        if inputs.shape[0] != self.weights.shape[1]:
            raise ValueError(
                f"Input size {inputs.shape[0]} doesn't match weight input size {self.weights.shape[1]}"
            )

        # Apply noise if requested
        weights = self.weights.copy()
        if add_noise:
            weights += np.random.normal(0, config.noise_sigma, weights.shape)

        # Linear transformation
        result = np.dot(weights, inputs) + self.biases

        # Apply activation
        if self.mode == "bipolar":
            return to_bipolar(result)
        else:
            return to_ternary(result, config)


# ========================================
# Multi-Layer Network
# ========================================
class TernaryNN:
    """Multi-layer ternary/bipolar neural network"""

    def __init__(
            self,
            layers: List[TernaryLayer],
            config: Optional[TernaryConfig] = None
    ):
        self.layers = layers
        self.config = config or TernaryConfig()

    def forward(
            self,
            inputs: np.ndarray,
            add_noise: bool = False,
            trace: bool = False
    ) -> Tuple[np.ndarray, List[np.ndarray], List[np.ndarray]]:
        """
        Forward pass through all layers.

        Args:
            inputs: Input vector
            add_noise: Whether to add noise during forward pass
            trace: Whether to print layer activations

        Returns:
            Tuple of:
            - Final activations
            - List of all layer activations (including input)
            - List of per-neuron energy for each transition
        """
        activations = np.asarray(inputs, dtype=np.float32).flatten()
        all_activations = [activations.copy()]
        all_energies = []

        if trace:
            print(f"Input: {activations}")

        prev_state = activations

        for i, layer in enumerate(self.layers):
            # Forward through layer
            activations = layer.forward(prev_state, self.config, add_noise)

            # Calculate energy
            energy = calculate_transition_energy(prev_state, activations, self.config)

            # Store results
            all_activations.append(activations.copy())
            all_energies.append(energy)

            if trace:
                print(f"Layer {i + 1}: activations={activations}, energy={energy.sum():.2f}")

            prev_state = activations

        return activations, all_activations, all_energies


# ========================================
# GPU Implementation
# ========================================
class TernaryNNGPU:
    """GPU-accelerated ternary neural network"""

    def __init__(
            self,
            layers: List[TernaryLayer],
            config: Optional[TernaryConfig] = None
    ):
        if not GPU_AVAILABLE:
            raise RuntimeError("GPU not available")

        self.layers = layers
        self.config = config or TernaryConfig()

        # Pre-transfer weights and biases to GPU
        self.gpu_layers = []
        for layer in layers:
            self.gpu_layers.append({
                'weights': cp.asarray(layer.weights),
                'biases': cp.asarray(layer.biases),
                'mode': layer.mode
            })

    def forward(
            self,
            inputs: np.ndarray,
            add_noise: bool = False,
            trace: bool = False
    ) -> Tuple[np.ndarray, List[np.ndarray], List[np.ndarray]]:
        """GPU-accelerated forward pass"""
        start_time = time.perf_counter()

        # Transfer input to GPU
        activations = cp.asarray(inputs, dtype=cp.float32).flatten()
        all_activations = [cp.asnumpy(activations)]
        all_energies = []

        prev_state = activations

        for i, gpu_layer in enumerate(self.gpu_layers):
            weights = gpu_layer['weights']
            biases = gpu_layer['biases']

            # Add noise if requested
            if add_noise:
                weights = weights + cp.random.normal(
                    0, self.config.noise_sigma, weights.shape, dtype=cp.float32
                )

            # Linear transformation (FIXED: correct dimension order)
            result = cp.dot(weights, prev_state) + biases

            # Apply activation
            if gpu_layer['mode'] == "bipolar":
                activations = cp.sign(result).astype(cp.int8)
                activations[activations == 0] = 1
            else:
                activations = cp.zeros_like(result, dtype=cp.int8)
                activations[result >= self.config.threshold_high] = 1
                activations[result <= self.config.threshold_low] = -1

            # Calculate energy (on CPU for now)
            prev_cpu = cp.asnumpy(prev_state)
            curr_cpu = cp.asnumpy(activations)
            energy = calculate_transition_energy(prev_cpu, curr_cpu, self.config)

            all_activations.append(curr_cpu)
            all_energies.append(energy)

            if trace:
                print(f"Layer {i + 1} (GPU): activations={curr_cpu}, energy={energy.sum():.2f}")

            prev_state = activations

        elapsed = time.perf_counter() - start_time

        final = cp.asnumpy(activations)

        if trace:
            print(f"GPU forward pass time: {elapsed * 1000:.3f}ms")

        return final, all_activations, all_energies


# ========================================
# Unified Interface
# ========================================
def run_forward(
        inputs: np.ndarray,
        layers: List[TernaryLayer],
        config: Optional[TernaryConfig] = None,
        use_gpu: bool = False,
        add_noise: bool = False,
        trace: bool = False
) -> Tuple[np.ndarray, List[np.ndarray], List[np.ndarray]]:
    """
    Run forward pass on CPU or GPU.

    Returns:
        (final_activations, all_activations, all_energies)
    """
    config = config or TernaryConfig()

    if use_gpu and GPU_AVAILABLE:
        try:
            nn = TernaryNNGPU(layers, config)
            return nn.forward(inputs, add_noise, trace)
        except Exception as e:
            print(f"GPU execution failed: {e}. Falling back to CPU.")

    nn = TernaryNN(layers, config)
    return nn.forward(inputs, add_noise, trace)


# ========================================
# Utilities
# ========================================
def create_random_layer(
        num_outputs: int,
        num_inputs: int,
        mode: str = "ternary",
        weight_dist: Tuple[float, float, float] = (0.3, 0.4, 0.3)
) -> TernaryLayer:
    """Create a random ternary layer"""
    weights = np.random.choice(
        [-1, 0, 1],
        size=(num_outputs, num_inputs),
        p=weight_dist
    ).astype(np.float32)

    biases = np.random.choice(
        [-1, 0, 1],
        size=num_outputs
    ).astype(np.float32)

    return TernaryLayer(weights, biases, mode)


def save_energy_results(
        results: Dict[str, Tuple],
        output_path: str
) -> None:
    """Save energy measurements to CSV"""
    with open(output_path, 'w', newline='') as f:
        writer = csv.writer(f)

        # Build header
        header = ["Run", "Mode", "Device"]
        max_layers = max(len(energies) for _, _, energies in results.values())
        for layer_idx in range(max_layers):
            header.append(f"Layer_{layer_idx + 1}_Total_Energy")
            header.append(f"Layer_{layer_idx + 1}_Num_Neurons")

        writer.writerow(header)

        # Write data
        for run_name, (final, activations, energies) in results.items():
            parts = run_name.split('_')
            mode = parts[0]
            device = parts[1]

            row = [run_name, mode, device]
            for energy_arr in energies:
                row.append(float(energy_arr.sum()))
                row.append(len(energy_arr))

            writer.writerow(row)

    print(f"Results saved to: {output_path}")


# ========================================
# Example Usage
# ========================================
if __name__ == "__main__":
    np.random.seed(42)

    # Create test inputs
    ternary_input = np.random.choice([-1, 0, 1], size=8, p=[0.3, 0.2, 0.5])
    bipolar_input = np.random.choice([-1, 1], size=8)

    print("=" * 60)
    print("TERNARY NEURAL NETWORK SIMULATION")
    print("=" * 60)

    # Create network architecture
    layers = [
        create_random_layer(8, 8, "ternary"),
        create_random_layer(6, 8, "ternary"),
        create_random_layer(4, 6, "ternary")
    ]

    config = TernaryConfig()

    # Run experiments
    results = {}

    print("\n--- CPU Ternary Mode ---")
    results['ternary_CPU'] = run_forward(
        ternary_input, layers, config, use_gpu=False, trace=True
    )

    print("\n--- GPU Ternary Mode ---")
    results['ternary_GPU'] = run_forward(
        ternary_input, layers, config, use_gpu=True, trace=True
    )

    # Bipolar mode
    bipolar_layers = [
        create_random_layer(8, 8, "bipolar"),
        create_random_layer(6, 8, "bipolar"),
        create_random_layer(4, 6, "bipolar")
    ]

    print("\n--- CPU Bipolar Mode ---")
    results['bipolar_CPU'] = run_forward(
        bipolar_input, bipolar_layers, config, use_gpu=False, trace=True
    )

    print("\n--- GPU Bipolar Mode ---")
    results['bipolar_GPU'] = run_forward(
        bipolar_input, bipolar_layers, config, use_gpu=True, trace=True
    )

    # Save results
    tmpdir = tempfile.mkdtemp()
    csv_path = os.path.join(tmpdir, "ternary_nn_energy.csv")
    save_energy_results(results, csv_path)

    print("\n" + "=" * 60)
    print(f"Output directory: {tmpdir}")
    print(f"Files: {os.listdir(tmpdir)}")
    print("=" * 60)